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
  admin_card_users:          'Utilisateurs',
  admin_card_universes_list: 'Univers',
  admin_card_users_total:    'Utilisateurs (total)',
  admin_card_users_active:   'Utilisateurs actifs (30 jours)',
  admin_users_active_pct:    '${pct}% des comptes',
  admin_purge_btn:      'Purger les fichiers orphelins',
  admin_universes_active_paused: '${active} actifs · ${paused} en pause',
  admin_orphans_count:  '${count} fichier(s) · ${size}',
  admin_purge_none:     'Aucun fichier orphelin.',
  admin_purge_done:     '${count} fichier(s) supprimé(s) (${size}).',
  admin_load_error:     'Erreur lors du chargement des statistiques.',
  toast_admin_purge_done: 'Fichiers orphelins purgés !',
  admin_search_users_ph:      'Rechercher par nom ou email…',
  admin_search_universes_ph:  'Rechercher par nom ou propriétaire…',
  admin_no_results:           'Aucun résultat.',
  admin_pagination_info:      'Page ${page}/${pages} · ${count} résultat(s)',
  admin_th_user:             'Utilisateur',
  admin_th_user_status:      'Statut (30 j)',
  admin_th_universes_owned:  'Univers possédés',
  admin_th_objects:          'Objets',
  admin_th_universe_limit:   'Limite d\'univers',
  admin_th_name:             'Nom',
  admin_th_owner:            'Propriétaire',
  admin_th_members:          'Membres',
  admin_th_status:           'Statut',
  admin_save_btn:            'Enregistrer',
  admin_pause_btn:           'Mettre en pause',
  admin_resume_btn:          'Réactiver',
  admin_delete_btn:          'Supprimer',
  admin_status_active:       'Actif',
  admin_status_inactive:     'Inactif',
  admin_status_paused:       'En pause',
  admin_limit_decrease:      'Diminuer la limite d’univers',
  admin_limit_increase:      'Augmenter la limite d’univers',
  admin_confirm_delete_universe: 'Suppression définitive de l\'univers "${name}" et de tout son contenu.\nTapez son nom pour confirmer :',
  admin_confirm_pause:       'Mettre l\'univers "${name}" en pause ?',
  admin_confirm_resume:      'Réactiver l\'univers "${name}" ?',
  toast_admin_limit_saved:   'Limite d\'univers mise à jour.',
  toast_admin_universe_paused:   'Univers mis en pause.',
  toast_admin_universe_resumed:  'Univers réactivé.',
  toast_admin_universe_deleted:  'Univers supprimé.',
  toast_admin_action_error:  'Erreur : ${message}',
  admin_card_news:           'Nouveautés',
  admin_news_lang_fr:        'Français',
  admin_news_lang_en:        'English',
  admin_news_title_ph:       'Titre',
  admin_news_content_ph:     'Contenu (markdown)',
  admin_news_title_en_ph:    'Titre (anglais)',
  admin_news_content_en_ph:  'Contenu (markdown, anglais)',
  admin_news_save_btn:       'Publier',
  admin_news_update_btn:     'Enregistrer',
  admin_news_cancel_btn:     'Annuler',
  admin_news_edit_btn:       'Modifier',
  admin_news_delete_btn:     'Supprimer',
  admin_news_confirm_delete: 'Supprimer la nouveauté "${title}" ?',
  admin_news_empty:          'Aucune nouveauté publiée.',
  admin_news_missing_fields: 'Titre et contenu obligatoires.',
  toast_admin_news_saved:    'Nouveauté enregistrée.',
  toast_admin_news_deleted:  'Nouveauté supprimée.',
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
  admin_card_users:          'Users',
  admin_card_universes_list: 'Universes',
  admin_card_users_total:    'Users (total)',
  admin_card_users_active:   'Active users (30 days)',
  admin_users_active_pct:    '${pct}% of accounts',
  admin_purge_btn:      'Purge orphan files',
  admin_universes_active_paused: '${active} active · ${paused} paused',
  admin_orphans_count:  '${count} file(s) · ${size}',
  admin_purge_none:     'No orphan files.',
  admin_purge_done:     '${count} file(s) deleted (${size}).',
  admin_load_error:     'Error while loading statistics.',
  toast_admin_purge_done: 'Orphan files purged!',
  admin_search_users_ph:      'Search by name or email…',
  admin_search_universes_ph:  'Search by name or owner…',
  admin_no_results:           'No results.',
  admin_pagination_info:      'Page ${page}/${pages} · ${count} result(s)',
  admin_th_user:             'User',
  admin_th_user_status:      'Status (30d)',
  admin_th_universes_owned:  'Owned universes',
  admin_th_objects:          'Objects',
  admin_th_universe_limit:   'Universe limit',
  admin_th_name:             'Name',
  admin_th_owner:            'Owner',
  admin_th_members:          'Members',
  admin_th_status:           'Status',
  admin_save_btn:            'Save',
  admin_pause_btn:           'Pause',
  admin_resume_btn:          'Resume',
  admin_delete_btn:          'Delete',
  admin_status_active:       'Active',
  admin_status_inactive:     'Inactive',
  admin_status_paused:       'Paused',
  admin_limit_decrease:      'Decrease universe limit',
  admin_limit_increase:      'Increase universe limit',
  admin_confirm_delete_universe: 'This will permanently delete the universe "${name}" and all its content.\nType its name to confirm:',
  admin_confirm_pause:       'Pause the universe "${name}"?',
  admin_confirm_resume:      'Resume the universe "${name}"?',
  toast_admin_limit_saved:   'Universe limit updated.',
  toast_admin_universe_paused:   'Universe paused.',
  toast_admin_universe_resumed:  'Universe resumed.',
  toast_admin_universe_deleted:  'Universe deleted.',
  toast_admin_action_error:  'Error: ${message}',
  admin_card_news:           "What's new",
  admin_news_lang_fr:        'Français',
  admin_news_lang_en:        'English',
  admin_news_title_ph:       'Title (French)',
  admin_news_content_ph:     'Content (markdown, French)',
  admin_news_title_en_ph:    'Title (English)',
  admin_news_content_en_ph:  'Content (markdown, English)',
  admin_news_save_btn:       'Publish',
  admin_news_update_btn:     'Save',
  admin_news_cancel_btn:     'Cancel',
  admin_news_edit_btn:       'Edit',
  admin_news_delete_btn:     'Delete',
  admin_news_confirm_delete: 'Delete the news item "${title}"?',
  admin_news_empty:          'No news published yet.',
  admin_news_missing_fields: 'Title and content are required.',
  toast_admin_news_saved:    'News item saved.',
  toast_admin_news_deleted:  'News item deleted.',
});

const adminPanel = {

  _prevAppVisible: false,
  _lastOrphans: [],
  _users: [],
  _universes: [],
  _pageSize: 10,
  _usersSearch: '',
  _usersPage: 1,
  _usersTotalPages: 1,
  _universesSearch: '',
  _universesPage: 1,
  _universesTotalPages: 1,
  _news: [],
  _newsEditingId: null,

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

    const [statsRes, usersRes, universesRes, newsRes] = await Promise.all([
      sb.rpc('admin_get_stats'),
      sb.rpc('admin_list_users'),
      sb.rpc('admin_list_universes'),
      sb.rpc('admin_list_news'),
    ]);

    if (statsRes.error) {
      console.error('admin_get_stats:', statsRes.error);
      showToast(t('admin_load_error'));
      loadingEl.style.display = 'none';
      return;
    }
    this._renderStats(statsRes.data);

    if (usersRes.error) console.error('admin_list_users:', usersRes.error);
    else { this._users = usersRes.data || []; this._renderUsers(); }

    if (universesRes.error) console.error('admin_list_universes:', universesRes.error);
    else { this._universes = universesRes.data || []; this._renderUniverses(); }

    if (newsRes.error) console.error('admin_list_news:', newsRes.error);
    else { this._news = newsRes.data || []; this._renderNews(); }

    await siteinfo.adminLoad();

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

    document.getElementById('admin-users-total-value').textContent = stats.users.total;
    document.getElementById('admin-users-active-value').textContent = stats.users.active_30d;
    document.getElementById('admin-users-active-breakdown').textContent = ti('admin_users_active_pct', {
      pct: stats.users.total ? Math.round((stats.users.active_30d / stats.users.total) * 100) : 0,
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

  // ── Pagination / recherche générique ────────────────────────────

  _paginate(items, page) {
    const totalPages = Math.max(1, Math.ceil(items.length / this._pageSize));
    const clampedPage = Math.min(Math.max(1, page), totalPages);
    const start = (clampedPage - 1) * this._pageSize;
    return { pageItems: items.slice(start, start + this._pageSize), page: clampedPage, totalPages };
  },

  _renderPagination(containerId, page, totalPages, count, onPrev, onNext) {
    const el = document.getElementById(containerId);
    if (!el) return;
    el.innerHTML = `
      <button class="btn-cancel admin-row-btn" ${page <= 1 ? 'disabled' : ''} onclick="${onPrev}">‹</button>
      <span>${ti('admin_pagination_info', { page, pages: totalPages, count })}</span>
      <button class="btn-cancel admin-row-btn" ${page >= totalPages ? 'disabled' : ''} onclick="${onNext}">›</button>`;
  },

  // ── Utilisateurs ──────────────────────────────────────────────

  onUsersSearch(value) {
    this._usersSearch = value;
    this._usersPage = 1;
    this._renderUsers();
  },

  usersPrevPage() {
    if (this._usersPage <= 1) return;
    this._usersPage--;
    this._renderUsers();
  },

  usersNextPage() {
    if (this._usersPage >= this._usersTotalPages) return;
    this._usersPage++;
    this._renderUsers();
  },

  _renderUsers() {
    const q = this._usersSearch.trim().toLowerCase();
    const filtered = q
      ? this._users.filter(u => (u.username || '').toLowerCase().includes(q) || (u.email || '').toLowerCase().includes(q))
      : this._users;

    const { pageItems, page, totalPages } = this._paginate(filtered, this._usersPage);
    this._usersPage = page;
    this._usersTotalPages = totalPages;

    const tbody = document.getElementById('admin-users-tbody');
    tbody.innerHTML = pageItems.length ? pageItems.map(u => `
      <tr>
        <td>
          <div class="admin-cell-title">${esc(u.username || '—')}</div>
          <div class="admin-cell-sub">${esc(u.email || '')}</div>
        </td>
        <td>
          <span class="admin-status-badge ${u.is_active ? 'active' : 'inactive'}">
            ${u.is_active ? t('admin_status_active') : t('admin_status_inactive')}
          </span>
        </td>
        <td>${u.owned_universes}</td>
        <td>${u.objects_count}</td>
        <td>
          <div class="admin-limit-stepper">
            <button type="button" class="admin-stepper-btn" id="admin-limit-minus-${esc(u.user_id)}"
                    onclick="adminPanel.adjustUserLimit('${u.user_id}', -1)"
                    aria-label="${esc(t('admin_limit_decrease'))}" title="${esc(t('admin_limit_decrease'))}"
                    ${u.max_universes <= 0 ? 'disabled' : ''}>−</button>
            <input type="number" min="0" class="admin-input-mini" id="admin-limit-input-${esc(u.user_id)}"
                   value="${u.max_universes}" inputmode="numeric"
                   oninput="adminPanel.syncUserLimitControls('${u.user_id}')">
            <button type="button" class="admin-stepper-btn"
                    onclick="adminPanel.adjustUserLimit('${u.user_id}', 1)"
                    aria-label="${esc(t('admin_limit_increase'))}" title="${esc(t('admin_limit_increase'))}">+</button>
          </div>
        </td>
        <td>
          <button class="btn-cancel admin-row-btn" onclick="adminPanel.saveUserLimit('${u.user_id}')" data-i18n="admin_save_btn">Enregistrer</button>
        </td>
      </tr>`).join('') : `<tr><td colspan="6" class="admin-empty-row" data-i18n="admin_no_results">Aucun résultat.</td></tr>`;

    this._renderPagination('admin-users-pagination', page, totalPages, filtered.length,
      'adminPanel.usersPrevPage()', 'adminPanel.usersNextPage()');
  },

  adjustUserLimit(userId, delta) {
    const input = document.getElementById(`admin-limit-input-${userId}`);
    if (!input) return;
    const current = parseInt(input.value, 10);
    input.value = Math.max(0, (Number.isFinite(current) ? current : 0) + delta);
    this.syncUserLimitControls(userId);
  },

  syncUserLimitControls(userId) {
    const input = document.getElementById(`admin-limit-input-${userId}`);
    const minusBtn = document.getElementById(`admin-limit-minus-${userId}`);
    const value = parseInt(input?.value, 10);
    if (minusBtn) minusBtn.disabled = !Number.isFinite(value) || value <= 0;
  },

  async saveUserLimit(userId) {
    const input = document.getElementById(`admin-limit-input-${userId}`);
    const value = parseInt(input?.value, 10);
    if (!Number.isFinite(value) || value < 0) return;

    const { error } = await sb.rpc('admin_set_user_max_universes', { p_user_id: userId, p_max_universes: value });
    if (error) {
      showToast(ti('toast_admin_action_error', { message: error.message }));
      return;
    }
    const user = this._users.find(u => u.user_id === userId);
    if (user) user.max_universes = value;
    showToast(t('toast_admin_limit_saved'));
  },

  // ── Univers ───────────────────────────────────────────────────

  onUniversesSearch(value) {
    this._universesSearch = value;
    this._universesPage = 1;
    this._renderUniverses();
  },

  universesPrevPage() {
    if (this._universesPage <= 1) return;
    this._universesPage--;
    this._renderUniverses();
  },

  universesNextPage() {
    if (this._universesPage >= this._universesTotalPages) return;
    this._universesPage++;
    this._renderUniverses();
  },

  _renderUniverses() {
    const q = this._universesSearch.trim().toLowerCase();
    const filtered = q
      ? this._universes.filter(u => (u.name || '').toLowerCase().includes(q) || (u.owner_username || '').toLowerCase().includes(q))
      : this._universes;

    const { pageItems, page, totalPages } = this._paginate(filtered, this._universesPage);
    this._universesPage = page;
    this._universesTotalPages = totalPages;

    const tbody = document.getElementById('admin-universes-tbody');
    tbody.innerHTML = pageItems.length ? pageItems.map(u => `
      <tr>
        <td class="admin-cell-title">${esc(u.name)}</td>
        <td>${esc(u.owner_username || '—')}</td>
        <td>${u.member_count}</td>
        <td>${u.objects_count}</td>
        <td>
          <span class="admin-status-badge ${u.paused_at ? 'paused' : 'active'}">
            ${u.paused_at ? t('admin_status_paused') : t('admin_status_active')}
          </span>
        </td>
        <td class="admin-row-actions">
          <button class="btn-cancel admin-row-btn" onclick="adminPanel.togglePauseUniverse('${u.universe_id}')">
            ${u.paused_at ? t('admin_resume_btn') : t('admin_pause_btn')}
          </button>
          <button class="btn-danger-outline admin-row-btn" onclick="adminPanel.deleteUniverseAsAdmin('${u.universe_id}')" data-i18n="admin_delete_btn">Supprimer</button>
        </td>
      </tr>`).join('') : `<tr><td colspan="6" class="admin-empty-row" data-i18n="admin_no_results">Aucun résultat.</td></tr>`;

    this._renderPagination('admin-universes-pagination', page, totalPages, filtered.length,
      'adminPanel.universesPrevPage()', 'adminPanel.universesNextPage()');
  },

  async togglePauseUniverse(universeId) {
    const universe = this._universes.find(u => u.universe_id === universeId);
    if (!universe) return;

    if (universe.paused_at) {
      if (!confirm(ti('admin_confirm_resume', { name: universe.name }))) return;
      const { error } = await sb.rpc('admin_resume_universe', { p_universe_id: universeId });
      if (error) { showToast(ti('toast_admin_action_error', { message: error.message })); return; }
      showToast(t('toast_admin_universe_resumed'));
    } else {
      if (!confirm(ti('admin_confirm_pause', { name: universe.name }))) return;
      const { error } = await sb.rpc('admin_pause_universe', { p_universe_id: universeId });
      if (error) { showToast(ti('toast_admin_action_error', { message: error.message })); return; }
      showToast(t('toast_admin_universe_paused'));
    }
    await this.loadStats();
  },

  async deleteUniverseAsAdmin(universeId) {
    const universe = this._universes.find(u => u.universe_id === universeId);
    if (!universe) return;

    const typed = prompt(ti('admin_confirm_delete_universe', { name: universe.name }));
    if (typed !== universe.name) return;

    const { data: illustrationUrls, error } = await sb.rpc('admin_delete_universe', { p_universe_id: universeId });
    if (error) { showToast(ti('toast_admin_action_error', { message: error.message })); return; }

    // Nettoyage du storage en best-effort : la ligne univers est déjà supprimée
    // (même logique que confirmDeleteUniverse() côté propriétaire).
    const charPaths = [...new Set((illustrationUrls || [])
      .map(u => _extractStoragePath(u, 'character-illustrations'))
      .filter(Boolean))];
    if (charPaths.length) {
      sb.storage.from('character-illustrations').remove(charPaths)
        .catch(e => console.warn('Nettoyage storage character-illustrations:', e));
    }
    const mapPaths = [...new Set((illustrationUrls || [])
      .map(u => _extractStoragePath(u, 'map-images'))
      .filter(Boolean))];
    if (mapPaths.length) {
      sb.storage.from('map-images').remove(mapPaths)
        .catch(e => console.warn('Nettoyage storage map-images:', e));
    }
    // Filet de sécurité : rattrape les fichiers de carte non référencés en base.
    sb.storage.from('map-images').list(universeId).then(({ data }) => {
      const paths = (data || []).map(f => `${universeId}/${f.name}`);
      if (paths.length) {
        sb.storage.from('map-images').remove(paths)
          .catch(e => console.warn('Nettoyage storage map-images (filet de sécurité):', e));
      }
    }).catch(e => console.warn('Listage storage map-images:', e));

    showToast(t('toast_admin_universe_deleted'));
    await this.loadStats();
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

  // ── Nouveautés ────────────────────────────────────────────────
  // Rédigées en markdown, rendues côté client dans la modale
  // whatsnew.js à la connexion (cf. sql/45_whatsnew.sql).

  _toLocalDatetimeInputValue(dateStr) {
    const d = new Date(dateStr);
    const local = new Date(d.getTime() - d.getTimezoneOffset() * 60000);
    return local.toISOString().slice(0, 16);
  },

  _renderNews() {
    const listEl = document.getElementById('admin-news-list');
    const locale = currentLang === 'en' ? 'en-US' : 'fr-FR';
    listEl.innerHTML = this._news.length ? this._news.map(n => `
      <div class="admin-news-item">
        <div>
          <div class="admin-news-item-title">${esc(n.title)}</div>
          <div class="admin-news-item-date">${new Date(n.published_at).toLocaleString(locale)}</div>
        </div>
        <div class="admin-news-item-actions">
          <button class="btn-cancel admin-row-btn" onclick="adminPanel.editNews('${n.id}')" data-i18n="admin_news_edit_btn">Modifier</button>
          <button class="btn-danger-outline admin-row-btn" onclick="adminPanel.deleteNews('${n.id}')" data-i18n="admin_news_delete_btn">Supprimer</button>
        </div>
      </div>`).join('') : `<div class="admin-empty-row" data-i18n="admin_news_empty">Aucune nouveauté publiée.</div>`;
  },

  editNews(id) {
    const item = this._news.find(n => n.id === id);
    if (!item) return;
    this._newsEditingId = id;
    document.getElementById('admin-news-editing-id').value = id;
    document.getElementById('admin-news-title').value = item.title;
    document.getElementById('admin-news-content').value = item.content_markdown;
    document.getElementById('admin-news-title-en').value = item.title_en || '';
    document.getElementById('admin-news-content-en').value = item.content_markdown_en || '';
    document.getElementById('admin-news-published-at').value = this._toLocalDatetimeInputValue(item.published_at);
    document.getElementById('admin-news-cancel-btn').style.display = '';
    document.getElementById('admin-news-save-btn').textContent = t('admin_news_update_btn');
    document.getElementById('admin-news-title').scrollIntoView({ behavior: 'smooth', block: 'center' });
  },

  cancelNewsEdit() {
    this._newsEditingId = null;
    document.getElementById('admin-news-editing-id').value = '';
    document.getElementById('admin-news-title').value = '';
    document.getElementById('admin-news-content').value = '';
    document.getElementById('admin-news-title-en').value = '';
    document.getElementById('admin-news-content-en').value = '';
    document.getElementById('admin-news-published-at').value = '';
    document.getElementById('admin-news-cancel-btn').style.display = 'none';
    document.getElementById('admin-news-save-btn').textContent = t('admin_news_save_btn');
  },

  async saveNews() {
    const title = document.getElementById('admin-news-title').value.trim();
    const content = document.getElementById('admin-news-content').value.trim();
    const titleEn = document.getElementById('admin-news-title-en').value.trim();
    const contentEn = document.getElementById('admin-news-content-en').value.trim();
    const publishedInput = document.getElementById('admin-news-published-at').value;
    if (!title || !content) { showToast(t('admin_news_missing_fields')); return; }

    const publishedAt = publishedInput ? new Date(publishedInput).toISOString() : new Date().toISOString();
    const editingId = this._newsEditingId;

    const { error } = editingId
      ? await sb.rpc('admin_update_news', { p_id: editingId, p_title: title, p_content_markdown: content, p_title_en: titleEn, p_content_markdown_en: contentEn, p_published_at: publishedAt })
      : await sb.rpc('admin_create_news', { p_title: title, p_content_markdown: content, p_title_en: titleEn, p_content_markdown_en: contentEn, p_published_at: publishedAt });

    if (error) { showToast(ti('toast_admin_action_error', { message: error.message })); return; }
    showToast(t('toast_admin_news_saved'));
    this.cancelNewsEdit();
    await this.loadStats();
  },

  async deleteNews(id) {
    const item = this._news.find(n => n.id === id);
    if (!item) return;
    if (!confirm(ti('admin_news_confirm_delete', { title: item.title }))) return;

    const { error } = await sb.rpc('admin_delete_news', { p_id: id });
    if (error) { showToast(ti('toast_admin_action_error', { message: error.message })); return; }
    showToast(t('toast_admin_news_deleted'));
    if (this._newsEditingId === id) this.cancelNewsEdit();
    await this.loadStats();
  },
};
