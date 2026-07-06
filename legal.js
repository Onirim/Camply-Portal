// ══════════════════════════════════════════════════════════════
// Camply — Mentions légales & confidentialité
//
// Modale d'information statique, accessible depuis l'écran de
// connexion (#auth-screen) et l'écran de choix d'univers
// (#universe-screen) via .legal-link (cf. index.html), les deux
// seuls écrans accessibles avant d'entrer dans un univers.
//
// Chargé après i18n.js.
// ══════════════════════════════════════════════════════════════

Object.assign(TRANSLATIONS.fr, {
  footer_legal_link: 'Mentions légales',
  legal_modal_title: 'Mentions légales',
});

Object.assign(TRANSLATIONS.en, {
  footer_legal_link: 'Legal notice',
  legal_modal_title: 'Legal notice',
});

const legalInfo = {

  open() {
    this._ensureModal();
    document.getElementById('legal-modal-title').textContent = t('legal_modal_title');
    document.getElementById('legal-modal').style.display = 'flex';
  },

  close() {
    const modal = document.getElementById('legal-modal');
    if (modal) modal.style.display = 'none';
  },

  // Construit le modal à la première utilisation (chrome visuel
  // identique aux modales transfert/pause, cf. transfert.css).
  // Contenu volontairement fourni en français uniquement : les
  // mentions légales françaises n'ont pas vocation à être traduites.
  _ensureModal() {
    if (document.getElementById('legal-modal')) return;
    const wrap = document.createElement('div');
    wrap.id = 'legal-modal';
    wrap.innerHTML = `
      <div id="legal-modal-panel">
        <div class="transfer-header">
          <div class="transfer-title">
            <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" width="15" height="15">
              <path d="M8 1.5l5.5 2.5v3.5c0 3.5-2.3 5.9-5.5 7-3.2-1.1-5.5-3.5-5.5-7V4l5.5-2.5z"/>
            </svg>
            <span id="legal-modal-title"></span>
          </div>
          <button class="transfer-close-btn" id="legal-modal-close-btn" title="✕">✕</button>
        </div>
        <div class="legal-body">
          <h3>Éditeur du site</h3>
          <p>
            Camply Portal est un site non professionnel, édité par <strong>Onirim</strong>.
            Conformément à l'article 6-III de la loi n° 2004-575 du 21 juin 2004 pour la
            confiance dans l'économie numérique, l'identité complète de l'éditeur est tenue
            à la disposition de l'hébergeur et des autorités compétentes.
          </p>
          <p>Contact : <a href="mailto:onirim.fox@proton.me">onirim.fox@proton.me</a></p>

          <h3>Hébergement</h3>
          <ul>
            <li>
              Site (front-end statique) : GitHub, Inc. — 88 Colin P Kelly Jr Street,
              San Francisco, CA 94107, USA —
              <a href="https://github.com" target="_blank" rel="noopener noreferrer">github.com</a>
            </li>
            <li>
              Données (comptes, univers, personnages, documents, images) : Supabase —
              <a href="https://supabase.com" target="_blank" rel="noopener noreferrer">supabase.com</a>
            </li>
          </ul>

          <h3>Propriété intellectuelle</h3>
          <p>
            Le code, la charte graphique et les textes de l'interface de Camply Portal sont la
            propriété de leur éditeur. Le contenu créé par les utilisateurs (univers,
            personnages, chroniques, documents, cartes, images) reste la propriété de leurs
            auteurs respectifs ; sa mise en ligne n'emporte aucune cession de droits au profit
            de l'éditeur du site.
          </p>

          <h3>Confidentialité des données (RGPD)</h3>
          <p>Les données suivantes sont collectées pour le fonctionnement du service :</p>
          <ul>
            <li>Adresse email, ou identifiant et avatar Discord en cas de connexion via Discord ;</li>
            <li>Contenu créé par l'utilisateur (univers, personnages, chroniques, documents, cartes, images) ;</li>
            <li>Horodatage de connexion et de dernière visite d'un univers, utilisé uniquement pour la mise en pause automatique des univers inactifs.</li>
          </ul>
          <p>
            Ces données sont hébergées par Supabase et ne sont ni revendues ni partagées à des
            fins publicitaires. Elles sont conservées tant que le compte ou l'univers concerné
            existe. Vous pouvez demander l'accès, la rectification ou la suppression de vos
            données à tout moment en écrivant à
            <a href="mailto:onirim.fox@proton.me">onirim.fox@proton.me</a>.
          </p>

          <div class="legal-note">
            Ces informations sont fournies en français conformément à la législation française
            applicable, quelle que soit la langue d'affichage du site.
          </div>
        </div>
      </div>`;
    document.body.appendChild(wrap);

    const modal = document.getElementById('legal-modal');
    const close = () => this.close();
    document.getElementById('legal-modal-close-btn').onclick = close;
    modal.onclick = e => { if (e.target === modal) close(); };
  },
};
