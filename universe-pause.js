// ══════════════════════════════════════════════════════════════
// Camply — Mise en pause des univers inactifs
//
// Un univers que personne n'a visité depuis 2 mois est mis en pause :
// ses données sont archivées côté serveur (cf. sql/29_universe_pause.sql)
// et sa card apparaît grisée avec un symbole pause. L'ouvrir demande
// confirmation à l'utilisateur (la restauration prend un peu de temps)
// puis réinjecte les données archivées.
//
// Chargé après i18n.js et supabase-client.js, avant scripts.js qui
// appelle universePause.* depuis loadUniversesFromDB(),
// renderUniverseList() et enterUniverse().
// ══════════════════════════════════════════════════════════════

// ── Traductions ────────────────────────────────────────────────
Object.assign(TRANSLATIONS.fr, {
  universe_paused_badge:   'En pause',
  pause_modal_title:       'Univers en pause',
  pause_modal_desc:        'L\'univers "${name}" a été mis en pause car personne ne l\'a visité depuis 2 mois. Ses données ont été archivées.',
  pause_modal_warning:     'La réactivation restaure toutes les données archivées et peut prendre un peu de temps. Voulez-vous continuer ?',
  pause_modal_confirm_btn: 'Réactiver l\'univers',
  pause_modal_resuming:    'Réactivation en cours…',
  toast_universe_resumed:  'Univers réactivé !',
  toast_resume_error:      'Erreur lors de la réactivation de l\'univers.',
});

Object.assign(TRANSLATIONS.en, {
  universe_paused_badge:   'Paused',
  pause_modal_title:       'Paused universe',
  pause_modal_desc:        'The universe "${name}" was paused because nobody visited it for 2 months. Its data has been archived.',
  pause_modal_warning:     'Reactivating restores all archived data and may take a little while. Do you want to continue?',
  pause_modal_confirm_btn: 'Reactivate universe',
  pause_modal_resuming:    'Reactivating…',
  toast_universe_resumed:  'Universe reactivated!',
  toast_resume_error:      'Error while reactivating the universe.',
});

const universePause = {

  isPaused(universe) {
    return !!(universe && universe.paused_at);
  },

  // Symbole pause façon radio-cassette : deux barres verticales.
  iconHTML(size = 11) {
    return `<svg viewBox="0 0 16 16" width="${size}" height="${size}" fill="currentColor" aria-hidden="true">
      <rect x="3.5" y="2.5" width="3.4" height="11" rx="0.9"/>
      <rect x="9.1" y="2.5" width="3.4" height="11" rx="0.9"/>
    </svg>`;
  },

  // Badge affiché dans la ligne meta de la card d'univers.
  cardBadgeHTML() {
    return `<span class="universe-pause-badge" title="${esc(t('pause_modal_title'))}">
      ${this.iconHTML(10)}<span>${esc(t('universe_paused_badge'))}</span>
    </span>`;
  },

  // ── Suivi des visites et pause automatique ───────────────────

  // Enregistre la visite de l'univers (fire-and-forget).
  touchVisit(universeId) {
    sb.rpc('touch_universe_visit', { p_universe_id: universeId })
      .then(({ error }) => {
        if (error) console.warn('touch_universe_visit:', error.message);
      });
  },

  // Met en pause les univers possédés par l'utilisateur courant que
  // personne n'a visités depuis 2 mois. Renvoie les ids mis en pause.
  async autoPauseStale() {
    const { data, error } = await sb.rpc('pause_stale_universes');
    if (error) {
      console.warn('Mise en pause automatique impossible:', error.message);
      return [];
    }
    return data || [];
  },

  // ── Confirmation + réactivation ──────────────────────────────

  // Appelé par enterUniverse() quand l'univers est en pause :
  // prévient l'utilisateur, et s'il confirme, restaure l'univers.
  // Résout à true si l'univers est réactivé.
  promptAndResume(universe) {
    this._ensureModal();
    const modal      = document.getElementById('universe-pause-modal');
    const descEl     = document.getElementById('universe-pause-desc');
    const confirmBtn = document.getElementById('universe-pause-confirm-btn');
    const cancelBtn  = document.getElementById('universe-pause-cancel-btn');
    const closeBtn   = document.getElementById('universe-pause-close-btn');
    const labelEl    = document.getElementById('universe-pause-confirm-label');

    // Textes (ré)appliqués à chaque ouverture : la langue a pu changer.
    document.getElementById('universe-pause-title').textContent   = t('pause_modal_title');
    document.getElementById('universe-pause-warning').textContent = t('pause_modal_warning');
    descEl.textContent        = ti('pause_modal_desc', { name: universe.name });
    labelEl.textContent       = t('pause_modal_confirm_btn');
    cancelBtn.textContent     = t('btn_cancel');
    confirmBtn.disabled       = false;
    cancelBtn.disabled        = false;
    modal.style.display       = 'flex';

    return new Promise(resolve => {
      let resuming = false;
      const close = value => {
        modal.style.display = 'none';
        resolve(value);
      };

      const cancel = () => { if (!resuming) close(false); };
      cancelBtn.onclick = cancel;
      closeBtn.onclick  = cancel;
      modal.onclick     = e => { if (e.target === modal) cancel(); };

      confirmBtn.onclick = async () => {
        resuming = true;
        confirmBtn.disabled = true;
        cancelBtn.disabled  = true;
        labelEl.textContent = t('pause_modal_resuming');

        const { data, error } = await sb.rpc('resume_universe', { p_universe_id: universe.id });
        if (error) {
          console.error('Erreur réactivation univers:', error);
          showToast(t('toast_resume_error'));
          close(false);
          return;
        }
        universe.paused_at = null;
        if (data && data.last_visited_at) universe.last_visited_at = data.last_visited_at;
        showToast(t('toast_universe_resumed'));
        close(true);
      };
    });
  },

  // Construit le modal à la première utilisation (chrome visuel
  // identique aux modales transfert/suppression, cf. transfert.css).
  _ensureModal() {
    if (document.getElementById('universe-pause-modal')) return;
    const wrap = document.createElement('div');
    wrap.id = 'universe-pause-modal';
    wrap.innerHTML = `
      <div id="universe-pause-modal-panel">
        <div class="transfer-header">
          <div class="transfer-title">
            ${this.iconHTML(15)}
            <span id="universe-pause-title"></span>
          </div>
          <button class="transfer-close-btn" id="universe-pause-close-btn" title="✕">✕</button>
        </div>
        <p class="transfer-desc" id="universe-pause-desc"></p>
        <div class="transfer-warning" style="display:flex">
          <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" width="14" height="14">
            <circle cx="8" cy="8" r="6.5"/>
            <path d="M8 4.5V8l2.5 1.5" stroke-linecap="round"/>
          </svg>
          <span id="universe-pause-warning"></span>
        </div>
        <div class="transfer-actions">
          <button class="btn-cancel" id="universe-pause-cancel-btn"></button>
          <button class="transfer-confirm-btn" id="universe-pause-confirm-btn">
            <svg viewBox="0 0 16 16" fill="currentColor" width="12" height="12" aria-hidden="true">
              <path d="M4.5 3.2v9.6c0 .5.55.8.98.55l7.6-4.8a.65.65 0 0 0 0-1.1l-7.6-4.8a.65.65 0 0 0-.98.55z"/>
            </svg>
            <span id="universe-pause-confirm-label"></span>
          </button>
        </div>
      </div>`;
    document.body.appendChild(wrap);
  },
};
