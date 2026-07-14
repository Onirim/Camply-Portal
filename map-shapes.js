// ══════════════════════════════════════════════════════════════
// Camply — Formes et pictogrammes des marqueurs de carte
//
// Chaque couleur de marqueur peut se voir attribuer une forme et
// un pictogramme par le propriétaire de l'univers (Configuration >
// Cartes). Les deux sont stockés dans le JSONB maps.marker_colors
// ({ color, label, shape, icon }) ; absence de `shape` = 'pin'
// (goutte), absence d'`icon` = point blanc central, ce qui garantit
// la rétrocompatibilité avec les cartes existantes.
//
// Dépend de : i18n.js (TRANSLATIONS)
// ══════════════════════════════════════════════════════════════

// ── Formes ────────────────────────────────────────────────────
// Chaque forme : viewBox (width/height), point d'ancrage, corps
// SVG coloré, centre visuel et encombrement maximal du pictogramme.
// anchor 'tip'    = la pointe basse de la forme désigne la position
//                   (translate(-50%, -100%), comme la goutte historique)
// anchor 'center' = le centre de la forme désigne la position
//                   (translate(-50%, -50%))
// center [cx,cy]  = position du point blanc / du pictogramme
// dot             = rayon du point blanc par défaut
// iconSize        = côté (en unités viewBox) du carré dans lequel
//                   le pictogramme est inscrit sans déborder
const MARKER_SHAPES = {
  pin: {
    width: 28, height: 40, anchor: 'tip',
    center: [14, 14], dot: 5.5, iconSize: 18.4,
    form: (color, opacity) => `
      <path d="M14 0C6.268 0 0 6.268 0 14c0 9.333 14 26 14 26s14-16.667 14-26C28 6.268 21.732 0 14 0z"
        fill="${color}" opacity="${opacity}"/>`,
  },
  circle: {
    width: 40, height: 40, anchor: 'center',
    center: [20, 20], dot: 7, iconSize: 25.3,
    form: (color, opacity) => `
      <circle cx="20" cy="20" r="19" fill="${color}" opacity="${opacity}"/>`,
  },
  diamond: {
    width: 40, height: 44, anchor: 'center',
    center: [20, 22], dot: 7, iconSize: 21.9,
    form: (color, opacity) => `
      <path d="M20 0L40 22L20 44L0 22Z" fill="${color}" opacity="${opacity}"/>`,
  },
  shield: {
    width: 40, height: 44, anchor: 'tip',
    center: [20, 18], dot: 7, iconSize: 23,
    form: (color, opacity) => `
      <path d="M20 0C28 4 34 5 40 5c0 18-7 30-20 39C7 35 0 23 0 5c6 0 12-1 20-5z"
        fill="${color}" opacity="${opacity}"/>`,
  },
  banner: {
    width: 40, height: 44, anchor: 'center',
    center: [20, 16], dot: 7, iconSize: 23,
    form: (color, opacity) => `
      <path d="M0 0h40v44L20 33L0 44Z" fill="${color}" opacity="${opacity}"/>`,
  },
  hexagon: {
    width: 40, height: 44, anchor: 'center',
    center: [20, 22], dot: 7, iconSize: 24.2,
    form: (color, opacity) => `
      <path d="M20 0L38 11v22L20 44L2 33V11Z" fill="${color}" opacity="${opacity}"/>`,
  },
  star: {
    width: 40, height: 40, anchor: 'center',
    center: [20, 20.5], dot: 5.5, iconSize: 13.8,
    form: (color, opacity) => `
      <path d="M20 0L24.9 13.2L39 13.8L28 22.6L31.8 36.2L20 28.4L8.2 36.2L12 22.6L1 13.8L15.1 13.2Z"
        fill="${color}" opacity="${opacity}"/>`,
  },
  square: {
    width: 40, height: 40, anchor: 'center',
    center: [20, 20], dot: 7, iconSize: 25.3,
    form: (color, opacity) => `
      <rect x="1" y="1" width="38" height="38" rx="6" fill="${color}" opacity="${opacity}"/>`,
  },
};

const MARKER_SHAPE_KEYS    = Object.keys(MARKER_SHAPES);
const MARKER_SHAPE_DEFAULT = 'pin';

// ── Pictogrammes ──────────────────────────────────────────────
// Silhouettes dessinées sur une grille 24×24, remplies en blanc
// sur la couleur de la forme. `stroke` = épaisseur de trait pour
// les rares icônes dessinées au trait plutôt qu'en aplat.
const MARKER_ICON_COLOR = 'white';

const MARKER_ICONS = {
  village:  { d: 'M4 20v-9l8-6 8 6v9h-5.5v-5.5h-5V20z' },
  fortress: { d: 'M5 20V7h3v2.5h2.5V7h3v2.5H16V7h3v13z' },
  tower:    { d: 'M8.5 20V7H10V4h1.3v3h1.4V4H14v3h1.5v13h-2.6v-3.5h-1.8V20z' },
  tree:     { d: 'M12 2l5.5 8.5h-3.2L19.5 18h-15L9.7 10.5H6.5z M10.9 18h2.2v3.5h-2.2z' },
  mountain: { d: 'M1.5 19.5L9 6l4.3 7.7 1.9-3.1 7.3 8.9z' },
  tent:     { d: 'M12 3.5L2.5 20h7l2.5-4.8L14.5 20h7z' },
  battle:   { d: 'M5.5 5.5L18.5 18.5M18.5 5.5L5.5 18.5M3.8 7.4L7.4 3.8M16.6 3.8l3.6 3.6', stroke: 2.4 },
  danger:   { d: 'M12 3a6.5 6.5 0 0 0-6.5 6.5c0 2.6 1.3 4.1 2.7 5V19h7.6v-4.5c1.4-.9 2.7-2.4 2.7-5A6.5 6.5 0 0 0 12 3zM9.7 8.3a1.7 1.7 0 1 1 0 3.4 1.7 1.7 0 0 1 0-3.4zm4.6 0a1.7 1.7 0 1 1 0 3.4 1.7 1.7 0 0 1 0-3.4z' },
  anchor:   { d: 'M13.9 5.2a1.9 1.9 0 1 1-3.8 0 1.9 1.9 0 0 1 3.8 0M12 7.2V20M8.5 9.5h7M4.5 13.5a7.5 7.5 0 0 0 15 0', stroke: 1.9 },
  temple:   { d: 'M3.5 12.8V11L12 4.5 20.5 11v1.8z M5 14.5h2.6V19H5z m5.7 0h2.6V19h-2.6z m5.7 0h2.6V19h-2.6z M4 20h16v1.5H4z' },
  star:     { d: 'M12 3l2.2 5.9 6.3.3-5 4 1.7 6.1L12 15.8 6.8 19.3l1.7-6.1-5-4 6.3-.3z' },
  crown:    { d: 'M3.5 18.5l-1.3-8.8 5.4 3.4L12 6.5l4.4 6.6 5.4-3.4-1.3 8.8z' },
  cross:    { d: 'M10 3.5h4v5.5h5.5v4H14v7h-4v-7H4.5v-4H10z' },
  cave:     { d: 'M3.5 20v-4.5a8.5 8.5 0 0 1 17 0V20h-5v-3a3.5 3.5 0 0 0-7 0v3z' },
  flame:    { d: 'M12 2.5c.7 3.6 5.6 5.2 5.6 9.7a5.6 5.6 0 0 1-11.2 0c0-2.7 1.7-4.2 2.4-6 .8 1.1 1.3 2.3 1.2 3.9 1.6-1.9 1.7-4.6 2-7.6z' },
  treasure: { d: 'M2.5 10.5V9a4 4 0 0 1 4-4h11a4 4 0 0 1 4 4v1.5z M2.5 12.5h19V20h-19z M10.5 10h3v3.5h-3z' },
};

const MARKER_ICON_KEYS = Object.keys(MARKER_ICONS);

// ── Rendu ─────────────────────────────────────────────────────

/** Retourne la définition d'une forme, avec repli sur la goutte. */
function getMarkerShapeDef(shape) {
  return MARKER_SHAPES[shape] || MARKER_SHAPES[MARKER_SHAPE_DEFAULT];
}

/** Attributs SVG de dessin d'un pictogramme (aplat ou trait). */
function _markerIconAttrs(icon, color) {
  return icon.stroke
    ? `stroke="${color}" stroke-width="${icon.stroke}" stroke-linecap="round" fill="none"`
    : `fill="${color}" fill-rule="evenodd"`;
}

/** Pictogramme positionné et mis à l'échelle au centre d'une forme. */
function _markerIconInShape(iconKey, def) {
  const icon = MARKER_ICONS[iconKey];
  if (!icon) return null;
  const s = def.iconSize;
  const tx = (def.center[0] - s / 2).toFixed(2);
  const ty = (def.center[1] - s / 2).toFixed(2);
  return `<g transform="translate(${tx} ${ty}) scale(${(s / 24).toFixed(3)})">
    <path d="${icon.d}" ${_markerIconAttrs(icon, MARKER_ICON_COLOR)}/></g>`;
}

/**
 * Construit le SVG complet d'un marqueur.
 * @param shape   clé de MARKER_SHAPES (repli sur 'pin' si inconnue)
 * @param color   couleur hex de remplissage
 * @param size    largeur rendue en px (la hauteur suit le ratio de la forme)
 * @param opts    { className, opacity, icon } — opacity s'applique au
 *                remplissage coloré uniquement ; icon = clé de
 *                MARKER_ICONS ('' ou inconnue = point blanc par défaut)
 */
function markerShapeSVG(shape, color, size, opts = {}) {
  const def = getMarkerShapeDef(shape);
  const h   = Math.round(size * def.height / def.width);
  const cls = opts.className ? ` class="${opts.className}"` : '';
  const centerMark = (opts.icon && _markerIconInShape(opts.icon, def))
    || `<circle cx="${def.center[0]}" cy="${def.center[1]}" r="${def.dot}" fill="white" opacity="0.95"/>`;
  return `<svg${cls} width="${size}" height="${h}"
    viewBox="0 0 ${def.width} ${def.height}" xmlns="http://www.w3.org/2000/svg">
    ${def.form(color, opts.opacity ?? 1)}${centerMark}
  </svg>`;
}

/**
 * SVG d'un pictogramme seul (boutons du sélecteur de la config),
 * dessiné en currentColor pour hériter de la couleur du texte.
 */
function markerIconSVG(iconKey, size) {
  const icon = MARKER_ICONS[iconKey];
  if (!icon) return '';
  return `<svg width="${size}" height="${size}" viewBox="0 0 24 24"
    xmlns="http://www.w3.org/2000/svg"><path d="${icon.d}" ${_markerIconAttrs(icon, 'currentColor')}/></svg>`;
}

// ── Traductions (mêmes clés que le pattern MAP_LEGEND_I18N de map.js) ──
const MARKER_SHAPES_I18N = {
  fr: {
    map_shape_pin:      'Goutte',
    map_shape_circle:   'Cercle',
    map_shape_diamond:  'Losange',
    map_shape_shield:   'Bouclier',
    map_shape_banner:   'Bannière',
    map_shape_hexagon:  'Hexagone',
    map_shape_star:     'Étoile',
    map_shape_square:   'Carré',
    map_icon_none:      'Aucun (point)',
    map_icon_village:   'Village',
    map_icon_fortress:  'Forteresse',
    map_icon_tower:     'Tour',
    map_icon_tree:      'Arbre',
    map_icon_mountain:  'Montagne',
    map_icon_tent:      'Tente',
    map_icon_battle:    'Combat',
    map_icon_danger:    'Danger',
    map_icon_anchor:    'Ancre',
    map_icon_temple:    'Temple',
    map_icon_star:      'Étoile',
    map_icon_crown:     'Couronne',
    map_icon_cross:     'Croix',
    map_icon_cave:      'Grotte',
    map_icon_flame:     'Flamme',
    map_icon_treasure:  'Trésor',
    map_admin_custom_btn:   'Personnaliser le marqueur',
    map_admin_picker_shape: 'Forme',
    map_admin_picker_icon:  'Pictogramme',
  },
  en: {
    map_shape_pin:      'Pin',
    map_shape_circle:   'Circle',
    map_shape_diamond:  'Diamond',
    map_shape_shield:   'Shield',
    map_shape_banner:   'Banner',
    map_shape_hexagon:  'Hexagon',
    map_shape_star:     'Star',
    map_shape_square:   'Square',
    map_icon_none:      'None (dot)',
    map_icon_village:   'Village',
    map_icon_fortress:  'Fortress',
    map_icon_tower:     'Tower',
    map_icon_tree:      'Tree',
    map_icon_mountain:  'Mountain',
    map_icon_tent:      'Tent',
    map_icon_battle:    'Battle',
    map_icon_danger:    'Danger',
    map_icon_anchor:    'Anchor',
    map_icon_temple:    'Temple',
    map_icon_star:      'Star',
    map_icon_crown:     'Crown',
    map_icon_cross:     'Cross',
    map_icon_cave:      'Cave',
    map_icon_flame:     'Flame',
    map_icon_treasure:  'Treasure',
    map_admin_custom_btn:   'Customize marker',
    map_admin_picker_shape: 'Shape',
    map_admin_picker_icon:  'Icon',
  },
};
Object.keys(MARKER_SHAPES_I18N).forEach(lang => {
  if (TRANSLATIONS[lang]) Object.assign(TRANSLATIONS[lang], MARKER_SHAPES_I18N[lang]);
});
