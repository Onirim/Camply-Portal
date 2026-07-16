// ══════════════════════════════════════════════════════════════
// Camply — Page d'information (« À propos »)
//
// Modale ouverte via le bouton « ? » de l'écran de choix d'univers
// (juste avant « + Créer un univers »). Trois sections fixes
// (« Pourquoi Camply ? », « Tarifs », « Comment ça marche »)
// naviguées par onglets, rédigées en markdown bilingue depuis le
// panneau d'administration (cf. sql/46_site_info.sql). Chrome visuel
// identique à whatsnew.js / legal.js.
//
// Chargé après i18n.js et supabase-client.js. La partie admin
// (siteinfo.adminLoad) est appelée depuis adminPanel.loadStats().
// ══════════════════════════════════════════════════════════════

Object.assign(TRANSLATIONS.fr, {
  siteinfo_btn_title:            'À propos de Camply',
  siteinfo_modal_title:          'À propos de Camply',
  admin_card_siteinfo:           "Page d'information",
  admin_siteinfo_save_btn:       'Enregistrer',
  admin_siteinfo_missing_fields: 'Le titre et le contenu français sont obligatoires.',
  toast_admin_siteinfo_saved:    'Section enregistrée.',
});

Object.assign(TRANSLATIONS.en, {
  siteinfo_btn_title:            'About Camply',
  siteinfo_modal_title:          'About Camply',
  admin_card_siteinfo:           'Info page',
  admin_siteinfo_save_btn:       'Save',
  admin_siteinfo_missing_fields: 'The French title and content are required.',
  toast_admin_siteinfo_saved:    'Section saved.',
});

const siteinfo = {

  _sections: [],
  _activeSlug: null,

  // ── Modale utilisateur ─────────────────────────────────────────

  async open() {
    const { data, error } = await sb.rpc('get_site_info');
    if (error) { console.warn('get_site_info:', error.message); return; }
    this._sections = data || [];
    if (!this._sections.length) return;

    if (!this._sections.some(s => s.slug === this._activeSlug)) {
      this._activeSlug = this._sections[0].slug;
    }
    this._ensureModal();
    this._render();
    document.getElementById('siteinfo-modal').style.display = 'flex';
  },

  close() {
    const modal = document.getElementById('siteinfo-modal');
    if (modal) modal.style.display = 'none';
  },

  selectTab(slug) {
    this._activeSlug = slug;
    this._render();
  },

  _render() {
    const en = currentLang === 'en';
    // Version anglaise si disponible, sinon repli sur le français.
    document.getElementById('siteinfo-tabs').innerHTML = this._sections.map(s => `
      <button class="siteinfo-tab${s.slug === this._activeSlug ? ' active' : ''}"
              onclick="siteinfo.selectTab('${s.slug}')">${esc((en && s.title_en) ? s.title_en : s.title)}</button>`).join('');

    const active = this._sections.find(s => s.slug === this._activeSlug);
    const content = active ? ((en && active.content_markdown_en) ? active.content_markdown_en : active.content_markdown) : '';
    document.getElementById('siteinfo-modal-body').innerHTML = renderMarkdown(content || '');
  },

  _ensureModal() {
    if (document.getElementById('siteinfo-modal')) return;
    const wrap = document.createElement('div');
    wrap.id = 'siteinfo-modal';
    wrap.innerHTML = `
      <div id="siteinfo-modal-panel">
        <div class="transfer-header">
          <div class="transfer-title">
            <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" width="15" height="15">
              <circle cx="8" cy="8" r="6.5"/>
              <path d="M6.3 6.1a1.8 1.8 0 1 1 2.5 1.9c-.5.25-.8.6-.8 1.1v.3"/>
              <line x1="8" y1="11.2" x2="8" y2="11.35"/>
            </svg>
            <span data-i18n="siteinfo_modal_title">À propos de Camply</span>
          </div>
          <button class="transfer-close-btn" id="siteinfo-modal-close-btn" title="✕">✕</button>
        </div>
        <div class="siteinfo-tabs" id="siteinfo-tabs"></div>
        <div class="siteinfo-body" id="siteinfo-modal-body"></div>
      </div>`;
    document.body.appendChild(wrap);

    const modal = document.getElementById('siteinfo-modal');
    const close = () => this.close();
    document.getElementById('siteinfo-modal-close-btn').onclick = close;
    modal.onclick = e => { if (e.target === modal) close(); };
    applyTranslations();
  },

  // ── Édition (panneau d'administration) ─────────────────────────

  _adminSlug: null,

  async adminLoad() {
    const { data, error } = await sb.rpc('get_site_info');
    if (error) { console.error('get_site_info:', error.message); return; }
    this._sections = data || [];

    const sel = document.getElementById('admin-siteinfo-section');
    if (!sel || !this._sections.length) return;

    const en = currentLang === 'en';
    sel.innerHTML = this._sections.map(s =>
      `<option value="${s.slug}">${esc((en && s.title_en) ? s.title_en : s.title)}</option>`).join('');

    if (!this._sections.some(s => s.slug === this._adminSlug)) {
      this._adminSlug = this._sections[0].slug;
    }
    sel.value = this._adminSlug;
    this.adminSelectSection(this._adminSlug);
  },

  adminSelectSection(slug) {
    this._adminSlug = slug;
    const s = this._sections.find(x => x.slug === slug);
    if (!s) return;
    document.getElementById('admin-siteinfo-title').value = s.title;
    document.getElementById('admin-siteinfo-content').value = s.content_markdown || '';
    document.getElementById('admin-siteinfo-title-en').value = s.title_en || '';
    document.getElementById('admin-siteinfo-content-en').value = s.content_markdown_en || '';
  },

  async adminSave() {
    if (!this._adminSlug) return;
    const title = document.getElementById('admin-siteinfo-title').value.trim();
    const content = document.getElementById('admin-siteinfo-content').value.trim();
    const titleEn = document.getElementById('admin-siteinfo-title-en').value.trim();
    const contentEn = document.getElementById('admin-siteinfo-content-en').value.trim();
    if (!title || !content) { showToast(t('admin_siteinfo_missing_fields')); return; }

    const { error } = await sb.rpc('admin_update_site_info', {
      p_slug: this._adminSlug,
      p_title: title,
      p_content_markdown: content,
      p_title_en: titleEn,
      p_content_markdown_en: contentEn,
    });
    if (error) { showToast(ti('toast_admin_action_error', { message: error.message })); return; }

    showToast(t('toast_admin_siteinfo_saved'));
    await this.adminLoad();
  },
};
