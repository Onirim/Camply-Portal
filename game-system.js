// ══════════════════════════════════════════════════════════════
// Camply TTRPG Manager — Système générique
// Remplacez ce fichier par votre propre game-system.js.
//
// Contrat : les fonctions et constantes exportées ci-dessous
// DOIVENT toutes être présentes et respecter leur signature.
// ══════════════════════════════════════════════════════════════


// ── 1. IDENTITÉ DU JEU ────────────────────────────────────────

const GAME_NAME     = 'Generic RPG';
const GAME_SUBTITLE = 'Gestionnaire de campagne';


// ── 2. ÉTAT INITIAL D'UN PERSONNAGE ──────────────────────────

function freshState() {
  return {
    name:                  '',
    subtitle:              '',      // titre / occupation
    race:                  '',      // race
    class:                 '',      // classe
    level:                 0,       // 0 = pas de niveau affiché
    is_public:             false,
    illustration_url:      '',
    illustration_position: 0,
    characteristics:       [],     // [{ id, name, trigram, score }]
    skills:                [],     // [{ id, name, score }]
    traits:                [],     // [{ id, name, score, detail }]
    description:           '',
    background:            '',
  };
}


// ── 3. HELPERS INTERNES ───────────────────────────────────────

function _uid() {
  return Math.random().toString(36).slice(2, 10);
}

function _clamp(v, min, max) {
  return Math.max(min, Math.min(max, v));
}


// ── Configuration des blocs de fiche (par univers) ────────────

const CHAR_BLOCKS = {
  subtitle:        'editor_field_subtitle',
  race:            'editor_field_race',
  class:           'editor_field_class',
  level:           'editor_field_level',
  characteristics: 'section_characteristics',
  skills:          'section_skills',
  traits:          'section_traits',
};

function getBlockConfig(key) {
  const cfg = (typeof currentUniverse !== 'undefined' && currentUniverse?.char_block_config) || {};
  const entry = cfg[key] || {};
  return {
    visible: entry.visible !== false,
    label:   entry.label || '',
  };
}

function blockVisible(key) {
  return getBlockConfig(key).visible;
}

function blockLabel(key) {
  const cfg = getBlockConfig(key);
  return cfg.label || t(CHAR_BLOCKS[key]);
}

// Le niveau a un libellé "long" (label de champ éditeur, ex: "Niveau")
// et un préfixe "court" affiché dans le rendu (ex: "Niv. "). Le libellé
// personnalisé, s'il existe, remplace les deux.
function levelRenderPrefix() {
  const cfg = getBlockConfig('level');
  const prefix = cfg.label || t('card_level');
  return prefix.trimEnd() + ' ';
}


// ══════════════════════════════════════════════════════════════
// 4. RENDU CARTE ROSTER
// ══════════════════════════════════════════════════════════════

function renderCharCardBody(c) {
  // Race + classe + niveau (niveau masqué si 0 ou si bloc désactivé)
  const raceTag = c.race && blockVisible('race')
    ? `<span class="card-race-tag">${esc(c.race)}</span>` : '';
  const classTag = c.class && blockVisible('class')
    ? `<span class="card-class-tag">${esc(c.class)}</span>` : '';
  const lvlTag = c.level !== undefined && c.level !== 0 && c.level !== null && blockVisible('level')
    ? `<span class="card-rank">${levelRenderPrefix()}${c.level}</span>` : '';

  // Extrait de la description (tronqué) — repli sur l'historique si vide
  const rawDescription = String(c.description || '').replace(/\s+/g, ' ').trim()
    || String(c.background || '').replace(/\s+/g, ' ').trim();
  const maxDescriptionLength = 180;
  const descriptionExcerpt = rawDescription
    ? rawDescription.slice(0, maxDescriptionLength).trimEnd() + (rawDescription.length > maxDescriptionLength ? '…' : '')
    : '';
  const descriptionHtml = `<div class="card-desc">${esc(descriptionExcerpt)}</div>`;

  return `
    <div class="card-name">${esc(c.name) || '—'}</div>
    ${c.subtitle && blockVisible('subtitle') ? `<div class="card-sub">${esc(c.subtitle)}</div>` : ''}
    <div style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:8px">
      ${raceTag}${classTag}${lvlTag}
    </div>
    ${descriptionHtml}
  `;
}


// ══════════════════════════════════════════════════════════════
// 5. RENDU FICHE COMPLÈTE (preview éditeur + vue partagée)
// ══════════════════════════════════════════════════════════════

function renderCharSheet(data) {

  // ── Illustration ──────────────────────────────────────────
  const illusHtml = data.illustration_url
    ? `<img class="preview-illus"
         src="${esc(data.illustration_url)}"
         style="object-position:center ${data.illustration_position || 0}%"
         onclick="openLightbox('${esc(data.illustration_url)}')" alt="">` : '';

  // ── En-tête ───────────────────────────────────────────────
  const raceTag = data.race && blockVisible('race')
    ? `<span class="card-race-tag">${esc(data.race)}</span>` : '';
  const classTag = data.class && blockVisible('class')
    ? `<span class="card-class-tag">${esc(data.class)}</span>` : '';

  // Niveau masqué si 0, null, ou si bloc désactivé
  const lvlBadge = data.level !== undefined && data.level !== 0 && data.level !== null && blockVisible('level')
    ? `<div class="preview-rank-badge">${levelRenderPrefix()}${data.level ?? 0}</div>` : '';

  const headerHtml = `
    <div class="preview-header">
      <div class="preview-name">${esc(data.name) || '—'}</div>
      ${data.subtitle && blockVisible('subtitle') ? `<div class="preview-sub">${esc(data.subtitle)}</div>` : ''}
      <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin-top:8px">
        ${raceTag}
        ${classTag}
        ${lvlBadge}
      </div>
    </div>`;

  // ── Caractéristiques (toutes, sans limite) ─────────────────
  // Au-delà de 6, on passe en petits blocs (comme les compétences)
  // pour ne pas surcharger l'interface ; 6 ou moins → grands blocs.
  const chars = blockVisible('characteristics') ? (data.characteristics || []) : [];
  const charsCompact = chars.length > 6;
  const charsBody = charsCompact
    ? `<div class="apt-preview-grid">
        ${chars.map(ch => `
          <div class="apt-preview-row">
            <span class="name">${esc(ch.name)}${ch.trigram ? ` <span style="color:var(--text3)">(${esc(ch.trigram)})</span>` : ''}</span>
            <span class="rank-num" style="color:var(--accent)">${ch.score ?? 0}</span>
          </div>`).join('')}
      </div>`
    : `<div class="preview-attrs">
        ${chars.map(ch => `
          <div class="preview-attr" style="border-left:3px solid var(--accent)">
            <div class="val" style="color:var(--accent);font-size:26px">${ch.score ?? 0}</div>
            <div class="lbl">${esc(ch.trigram || '???')}</div>
            <div class="cost" style="font-size:11px;color:var(--text2);margin-top:2px">${esc(ch.name)}</div>
          </div>`).join('')}
      </div>`;
  const charsHtml = chars.length ? `
    <div class="preview-section-title">${blockLabel('characteristics')}</div>
    ${charsBody}` : '';

  // ── Compétences ───────────────────────────────────────────
  const skills = blockVisible('skills') ? (data.skills || []) : [];
  const skillsHtml = skills.length ? `
    <div class="preview-section-title">${blockLabel('skills')}</div>
    <div class="apt-preview-grid">
      ${skills.map(sk => `
        <div class="apt-preview-row">
          <span class="name">${esc(sk.name)}</span>
          <span class="rank-num">${sk.score ?? 0}</span>
        </div>`).join('')}
    </div>` : '';

  // ── Traits (sans type, juste nom + score + description) ───
  const traits = blockVisible('traits') ? (data.traits || []) : [];
  const traitsHtml = traits.length ? `
    <div class="preview-section-title">${blockLabel('traits')}</div>
    <div class="compl-preview">
      ${traits.map(tr => `
        <div class="compl-chip" style="border-left:3px solid ${esc(tr.color || 'var(--border2)')}">
          <div style="display:flex;justify-content:space-between;align-items:center">
            <span>${esc(tr.name)}</span>
            ${tr.score !== '' && tr.score !== undefined && tr.score !== null
              ? `<span style="font-family:var(--font-mono);font-size:12px;color:var(--accent);font-weight:700">${tr.score}</span>`
              : ''}
          </div>
          ${tr.detail ? `<div class="compl-detail">${esc(tr.detail)}</div>` : ''}
        </div>`).join('')}
    </div>` : '';

  // ── Description ───────────────────────────────────────────
  const descriptionHtml = data.description ? `
    <div class="preview-section-title">${t('section_description')}</div>
    <div class="background-preview">${esc(data.description)}</div>` : '';

  // ── Background ────────────────────────────────────────────
  const bgHtml = data.background ? `
    <div class="preview-section-title">${t('section_background')}</div>
    <div class="background-preview">${esc(data.background)}</div>` : '';

  return `${illusHtml}${headerHtml}${charsHtml}${skillsHtml}${traitsHtml}${descriptionHtml}${bgHtml}`;
}


// ══════════════════════════════════════════════════════════════
// 6. TRADUCTIONS (clés spécifiques au jeu)
// ══════════════════════════════════════════════════════════════

const GAME_I18N = {
  fr: {
    // Identité
    editor_field_subtitle:     'Titre / Occupation',
    editor_field_race:         'Race',
    editor_field_class:        'Classe',
    editor_field_level:        'Niveau',

    // Carte roster
    card_level: 'Niv. ',

    // Sections fiche
    section_characteristics: 'Caractéristiques',
    section_skills:          'Compétences',
    section_traits:          'Traits',
    section_description:     'Description',
    section_background:      'Background',

    // Éditeur — caractéristiques
    editor_section_characteristics:   'Caractéristiques',
    editor_char_name_ph:              'Nom complet (ex : Force)',
    editor_char_trigram_ph:           'TRI',
    editor_char_score_label:          'Score',
    editor_char_score_hint:           'Shift+clic : ±10',
    editor_add_characteristic:        '+ Ajouter un élément',

    // Éditeur — compétences
    editor_section_skills:    'Compétences',
    editor_skill_name_ph:     'Nom de la compétence',
    editor_skill_score_hint:  'Shift+clic : ±10',
    editor_add_skill:         '+ Ajouter un élément',

    // Éditeur — traits
    editor_section_traits:    'Traits',
    editor_trait_name_ph:     'Nom du trait',
    editor_trait_detail_ph:   'Description ou détail (optionnel)',
    editor_trait_score_hint:  'Valeur (optionnel)',
    editor_add_trait:         '+ Ajouter un élément',

    // Éditeur — background
    editor_section_description: 'Description',
    editor_description_ph:      'Description du personnage, apparence, attitude…',
    
    editor_section_background: 'Background',
    editor_background_ph:      'Histoire du personnage, origines, motivations…',

    // Éditeur — réorganisation des entrées
    editor_reorder_tooltip: 'Réorganiser les entrées',

    // Alertes
    alert_char_no_name:  'Veuillez donner un nom au personnage.',
    alert_trigram_3:     'Le trigramme doit faire exactement 3 lettres.',

    // Configuration univers — blocs de fiche de personnage
    config_section_char_blocks: 'Fiche de personnage',
    config_char_blocks_hint:    'Activez ou désactivez ces blocs et renommez-les pour tous les personnages de cet univers.',
    config_block_visible_col:   'Afficher',
    config_block_label_col:     'Libellé personnalisé',
    config_block_label_ph:      'Libellé par défaut',
  },

  en: {
    editor_field_subtitle:     'Title / Occupation',
    editor_field_race:         'Race',
    editor_field_class:        'Class',
    editor_field_level:        'Level',

    card_level: 'Lv. ',

    section_characteristics: 'Characteristics',
    section_skills:          'Skills',
    section_traits:          'Traits',
    section_description:     'Description',
    section_background:      'Background',

    editor_section_characteristics:   'Characteristics',
    editor_char_name_ph:              'Full name (e.g. Strength)',
    editor_char_trigram_ph:           'TRI',
    editor_char_score_label:          'Score',
    editor_char_score_hint:           'Shift+click: ±10',
    editor_add_characteristic:        '+ Add an item',

    editor_section_skills:    'Skills',
    editor_skill_name_ph:     'Skill name',
    editor_skill_score_hint:  'Shift+click: ±10',
    editor_add_skill:         '+ Add an item',

    editor_section_traits:    'Traits',
    editor_trait_name_ph:     'Trait name',
    editor_trait_detail_ph:   'Description or detail (optional)',
    editor_trait_score_hint:  'Value (optional)',
    editor_add_trait:         '+ Add an item',

    editor_section_description: 'Description',
    editor_description_ph:      'Character description, appearance, attitude…',

    editor_section_background: 'Background',
    editor_background_ph:      'Character history, origins, motivations…',

    editor_reorder_tooltip: 'Reorder entries',

    alert_char_no_name:  'Please give the character a name.',
    alert_trigram_3:     'Trigram must be exactly 3 letters.',

    config_section_char_blocks: 'Character sheet',
    config_char_blocks_hint:    'Toggle these blocks on/off and rename them for every character in this universe.',
    config_block_visible_col:   'Show',
    config_block_label_col:     'Custom label',
    config_block_label_ph:      'Default label',
  },
};

Object.keys(GAME_I18N).forEach(lang => {
  if (TRANSLATIONS[lang]) Object.assign(TRANSLATIONS[lang], GAME_I18N[lang]);
});
