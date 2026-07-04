// ══════════════════════════════════════════════════════════════
// Camply — Panneau d'administration
//
// Statistiques globales (objets, univers, stockage, base de données,
// images orphelines) et purge des fichiers orphelins. Réservé aux
// comptes listés dans public.admin_users (cf. sql/30_admin_panel.sql) :
// l'entrée de menu (.admin-menu-item) reste masquée pour tout le monde
// d'autre, et chaque RPC admin_* revérifie is_admin() côté serveur.
//
// Chargé après i18n.js et supabase-client.js, avant scripts.js qui
// appelle adminPanel.checkAndShowMenu() depuis onSignedIn().
// ══════════════════════════════════════════════════════════════

Object.assign(TRANSLATIONS.fr, {
  user_admin_panel:     'Panneau d\'administration',
  admin_back_btn:       '← Retour',
  admin_title:          'Panneau d\'administration',
  admin_refresh_btn:    'Actualiser',
  admin_card_objects:   'Objets des utilisateurs',
  admin_card_universes: 'Univers',
  admin_card_storage:   'Stockage (fichiers)',
  admin_card_database:  'Base de données',
  admin_card_orphans:   'Images orphelines',
  admin_purge_btn:      'Purger les fichiers orphelins',
  admin_universes_active_paused: '${active} actifs · ${paused} en pause',
  admin_orphans_count:  '${count} fichier(s) · ${size}',
  admin_purge_none:     'Aucun fichier orphelin.',
  admin_purge_done:     '${count} fichier(s) supprimé(s) (${size}).',
  admin_load_error:     'Erreur lors du chargement des statistiques.',
  toast_admin_purge_done: 'Fichiers orphelins purgés !',
});

Object.assign(TRANSLATIONS.en, {
  user_admin_panel:     'Admin panel',
  admin_back_btn:       '← Back',
  admin_title:          'Admin panel',
  admin_refresh_btn:    'Refresh',
  admin_card_objects:   'User objects',
  admin_card_universes: 'Universes',
  admin_card_storage:   'Storage (files)',
  admin_card_database:  'Database',
  admin_card_orphans:   'Orphan images',
  admin_purge_btn:      'Purge orphan files',
  admin_universes_active_paused: '${active} active · ${paused} paused',
  admin_orphans_count:  '${count} file(s) · ${size}',
  admin_purge_none:     'No orphan files.',
  admin_purge_done:     '${count} file(s) deleted (${size}).',
  admin_load_error:     'Error while loading statistics.',
  toast_admin_purge_done: 'Orphan files purged!',
});

const adminPanel = {

  _prevAppVisible: false,
  _lastOrphans: [],

  formatBytes(bytes) {
    if (!bytes) return '0 MB';
    const mb = bytes / (1024 * 1024);
    if (mb >= 1024) return (mb / 1024).toFixed(2) + ' GB';
    return mb.toFixed(1) + ' MB';
  },

  // Affiché quand l'utilisateur courant est admin (fire-and-forget,
  // appelé après chaque connexion).
  async checkAndShowMenu() {
    const { data, error } = await sb.rpc('is_admin');
    if (error) { console.warn('is_admin:', error.message); return; }
    document.querySelectorAll('.admin-menu-item').forEach(el => el.style.display = data ? '' : 'none');
  },

  async open() {
    toggleUserMenu(false);
    this._prevAppVisible = document.getElementById('app').style.display !== 'none';
    document.getElementById('auth-screen').classList.remove('active');
    document.getElementById('universe-screen')?.classList.remove('active');
    document.getElementById('app').style.display = 'none';
    document.getElementById('admin-screen').classList.add('active');
    applyTranslations();
    await this.loadStats();
  },

  close() {
    document.getElementById('admin-screen').classList.remove('active');
    if (this._prevAppVisible) document.getElementById('app').style.display = 'flex';
    else showUniverseScreen();
  },

  async loadStats() {
    const loadingEl = document.getElementById('admin-loading');
    const contentEl = document.getElementById('admin-content');
    loadingEl.style.display = 'flex';
    contentEl.style.display = 'none';
    document.getElementById('admin-purge-result').textContent = '';

    const { data, error } = await sb.rpc('admin_get_stats');
    if (error) {
      console.error('admin_get_stats:', error);
      showToast(t('admin_load_error'));
      loadingEl.style.display = 'none';
      return;
    }

    this._renderStats(data);
    loadingEl.style.display = 'none';
    contentEl.style.display = 'grid';
  },

  _renderStats(stats) {
    document.getElementById('admin-objects-total').textContent = stats.objects.total;
    document.getElementById('admin-objects-breakdown').innerHTML = `
      <span>${t('nav_characters')}: ${stats.objects.characters}</span>
      <span>${t('nav_chronicles')}: ${stats.objects.chronicles}</span>
      <span>${t('nav_documents')}: ${stats.objects.documents}</span>
      <span>${t('nav_campaigns')}: ${stats.objects.campaigns}</span>
      <span>${t('nav_map')}: ${stats.objects.maps}</span>`;

    document.getElementById('admin-universes-total').textContent = stats.universes.total;
    document.getElementById('admin-universes-breakdown').textContent = ti('admin_universes_active_paused', {
      active: stats.universes.active, paused: stats.universes.paused,
    });

    const storagePct = Math.min(100, (stats.storage.bytes / stats.storage.limit_bytes) * 100);
    document.getElementById('admin-storage-value').textContent =
      `${this.formatBytes(stats.storage.bytes)} / ${this.formatBytes(stats.storage.limit_bytes)}`;
    const storageBar = document.getElementById('admin-storage-bar');
    storageBar.style.width = storagePct + '%';
    storageBar.classList.toggle('warning', storagePct >= 80);

    const dbPct = Math.min(100, (stats.database.bytes / stats.database.limit_bytes) * 100);
    document.getElementById('admin-database-value').textContent =
      `${this.formatBytes(stats.database.bytes)} / ${this.formatBytes(stats.database.limit_bytes)}`;
    const dbBar = document.getElementById('admin-database-bar');
    dbBar.style.width = dbPct + '%';
    dbBar.classList.toggle('warning', dbPct >= 80);

    document.getElementById('admin-orphans-value').textContent = ti('admin_orphans_count', {
      count: stats.orphans.count, size: this.formatBytes(stats.orphans.bytes),
    });
  },

  // ── Purge des illustrations orphelines ───────────────────────
  async purgeOrphans() {
    const btn = document.getElementById('admin-purge-btn');
    const resultEl = document.getElementById('admin-purge-result');
    resultEl.textContent = '';
    btn.disabled = true;

    const { data, error } = await sb.rpc('admin_list_orphan_illustrations');
    if (error) {
      showToast(t('admin_load_error') + ' ' + error.message);
      btn.disabled = false;
      return;
    }

    const orphans = data || [];
    if (!orphans.length) {
      resultEl.textContent = t('admin_purge_none');
      btn.disabled = false;
      return;
    }

    const totalBytes = orphans.reduce((sum, o) => sum + (o.size_bytes || 0), 0);
    if (!confirm(ti('confirm_cleanup_orphans', { count: orphans.length, size: (totalBytes / (1024 * 1024)).toFixed(1) }))) {
      btn.disabled = false;
      return;
    }

    const pathsByBucket = {};
    orphans.forEach(o => { (pathsByBucket[o.bucket_id] ||= []).push(o.path); });

    let deletedCount = 0;
    for (const [bucketId, paths] of Object.entries(pathsByBucket)) {
      const { data: removed, error: rmError } = await sb.storage.from(bucketId).remove(paths);
      if (rmError) { console.warn('Purge storage', bucketId, rmError); continue; }
      deletedCount += (removed || []).length;
    }

    resultEl.textContent = ti('admin_purge_done', { count: deletedCount, size: (totalBytes / (1024 * 1024)).toFixed(1) });
    showToast(t('toast_admin_purge_done'));
    btn.disabled = false;
    await this.loadStats();
  },
};
