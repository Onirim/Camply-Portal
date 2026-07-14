// ══════════════════════════════════════════════════════════════
// Camply — Nouveautés
//
// Modale affichée automatiquement après connexion lorsque des
// nouveautés (rédigées en markdown depuis le panneau d'administration,
// cf. sql/45_whatsnew.sql) ont été publiées depuis la dernière visite
// de l'utilisateur. Chrome visuel identique à legal.js.
//
// Chargé après i18n.js et supabase-client.js ; appelé depuis
// onSignedIn() dans scripts.js, une fois l'écran de destination
// affiché (universe-screen ou univers repris via l'URL).
// ══════════════════════════════════════════════════════════════

Object.assign(TRANSLATIONS.fr, {
  whatsnew_modal_title: 'Nouveautés',
});

Object.assign(TRANSLATIONS.en, {
  whatsnew_modal_title: "What's new",
});

const whatsnew = {

  _entries: [],

  async checkAndShow() {
    const { data, error } = await sb.rpc('get_unseen_news');
    if (error) { console.warn('get_unseen_news:', error.message); return; }
    if (!data || !data.length) return;

    this._entries = data;
    this._ensureModal();
    this._render();
    document.getElementById('whatsnew-modal').style.display = 'flex';
  },

  close() {
    const modal = document.getElementById('whatsnew-modal');
    if (modal) modal.style.display = 'none';
    this._markSeen();
  },

  async _markSeen() {
    if (!this._entries.length) return;
    const upTo = this._entries[this._entries.length - 1].published_at;
    this._entries = [];
    const { error } = await sb.rpc('mark_news_seen', { p_up_to: upTo });
    if (error) console.warn('mark_news_seen:', error.message);
  },

  _render() {
    const body = document.getElementById('whatsnew-modal-body');
    const locale = currentLang === 'en' ? 'en-US' : 'fr-FR';
    body.innerHTML = this._entries.map(n => `
      <div class="whatsnew-entry">
        <div class="whatsnew-entry-header">
          <h3>${esc(n.title)}</h3>
          <span class="whatsnew-entry-date">${new Date(n.published_at).toLocaleDateString(locale, { day: 'numeric', month: 'long', year: 'numeric' })}</span>
        </div>
        <div class="whatsnew-entry-body">${renderMarkdown(n.content_markdown)}</div>
      </div>`).join('');
  },

  _ensureModal() {
    if (document.getElementById('whatsnew-modal')) return;
    const wrap = document.createElement('div');
    wrap.id = 'whatsnew-modal';
    wrap.innerHTML = `
      <div id="whatsnew-modal-panel">
        <div class="transfer-header">
          <div class="transfer-title">
            <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" width="15" height="15">
              <path d="M8 1.5l1.4 3.9 3.9 1.4-3.9 1.4L8 12.1l-1.4-3.9-3.9-1.4 3.9-1.4L8 1.5z"/>
            </svg>
            <span data-i18n="whatsnew_modal_title">Nouveautés</span>
          </div>
          <button class="transfer-close-btn" id="whatsnew-modal-close-btn" title="✕">✕</button>
        </div>
        <div class="whatsnew-body" id="whatsnew-modal-body"></div>
      </div>`;
    document.body.appendChild(wrap);

    const modal = document.getElementById('whatsnew-modal');
    const close = () => this.close();
    document.getElementById('whatsnew-modal-close-btn').onclick = close;
    modal.onclick = e => { if (e.target === modal) close(); };
    applyTranslations();
  },
};
