// ══════════════════════════════════════════════════════════════
// Camply — Formes des marqueurs de carte
//
// Chaque couleur de marqueur peut se voir attribuer une forme par
// le propriétaire de l'univers (Configuration > Cartes). La forme
// est stockée dans le JSONB maps.marker_colors sous la clé `shape`
// ({ color, label, shape }) ; absence de `shape` = 'pin' (goutte),
// ce qui garantit la rétrocompatibilité avec les cartes existantes.
//
// Dépend de : i18n.js (TRANSLATIONS)
// ══════════════════════════════════════════════════════════════

// Chaque forme : viewBox (width/height), point d'ancrage et corps SVG.
// anchor 'tip'    = la pointe basse de la forme désigne la position
//                   (translate(-50%, -100%), comme la goutte historique)
// anchor 'center' = le centre de la forme désigne la position
//                   (translate(-50%, -50%))
const MARKER_SHAPES = {
  pin: {
    width: 28, height: 40, anchor: 'tip',
    body: (color, opacity) => `
      <path d="M14 0C6.268 0 0 6.268 0 14c0 9.333 14 26 14 26s14-16.667 14-26C28 6.268 21.732 0 14 0z"
        fill="${color}" opacity="${opacity}"/>
      <circle cx="14" cy="14" r="5.5" fill="white" opacity="0.95"/>`,
  },
  circle: {
    width: 40, height: 40, anchor: 'center',
    body: (color, opacity) => `
      <circle cx="20" cy="20" r="19" fill="${color}" opacity="${opacity}"/>
      <circle cx="20" cy="20" r="7" fill="white" opacity="0.95"/>`,
  },
  diamond: {
    width: 40, height: 44, anchor: 'center',
    body: (color, opacity) => `
      <path d="M20 0L40 22L20 44L0 22Z" fill="${color}" opacity="${opacity}"/>
      <circle cx="20" cy="22" r="7" fill="white" opacity="0.95"/>`,
  },
  shield: {
    width: 40, height: 44, anchor: 'tip',
    body: (color, opacity) => `
      <path d="M20 0C28 4 34 5 40 5c0 18-7 30-20 39C7 35 0 23 0 5c6 0 12-1 20-5z"
        fill="${color}" opacity="${opacity}"/>
      <circle cx="20" cy="18" r="7" fill="white" opacity="0.95"/>`,
  },
  banner: {
    width: 40, height: 44, anchor: 'center',
    body: (color, opacity) => `
      <path d="M0 0h40v44L20 33L0 44Z" fill="${color}" opacity="${opacity}"/>
      <circle cx="20" cy="16" r="7" fill="white" opacity="0.95"/>`,
  },
  hexagon: {
    width: 40, height: 44, anchor: 'center',
    body: (color, opacity) => `
      <path d="M20 0L38 11v22L20 44L2 33V11Z" fill="${color}" opacity="${opacity}"/>
      <circle cx="20" cy="22" r="7" fill="white" opacity="0.95"/>`,
  },
  star: {
    width: 40, height: 40, anchor: 'center',
    body: (color, opacity) => `
      <path d="M20 0L24.9 13.2L39 13.8L28 22.6L31.8 36.2L20 28.4L8.2 36.2L12 22.6L1 13.8L15.1 13.2Z"
        fill="${color}" opacity="${opacity}"/>
      <circle cx="20" cy="20.5" r="5.5" fill="white" opacity="0.95"/>`,
  },
  square: {
    width: 40, height: 40, anchor: 'center',
    body: (color, opacity) => `
      <rect x="1" y="1" width="38" height="38" rx="6" fill="${color}" opacity="${opacity}"/>
      <circle cx="20" cy="20" r="7" fill="white" opacity="0.95"/>`,
  },
};

const MARKER_SHAPE_KEYS   = Object.keys(MARKER_SHAPES);
const MARKER_SHAPE_DEFAULT = 'pin';

/** Retourne la définition d'une forme, avec repli sur la goutte. */
function getMarkerShapeDef(shape) {
  return MARKER_SHAPES[shape] || MARKER_SHAPES[MARKER_SHAPE_DEFAULT];
}

/**
 * Construit le SVG complet d'un marqueur.
 * @param shape   clé de MARKER_SHAPES (repli sur 'pin' si inconnue)
 * @param color   couleur hex de remplissage
 * @param size    largeur rendue en px (la hauteur suit le ratio de la forme)
 * @param opts    { className, opacity } — opacity s'applique au remplissage
 *                coloré uniquement (le point blanc central reste à 0.95)
 */
function markerShapeSVG(shape, color, size, opts = {}) {
  const def = getMarkerShapeDef(shape);
  const h   = Math.round(size * def.height / def.width);
  const cls = opts.className ? ` class="${opts.className}"` : '';
  return `<svg${cls} width="${size}" height="${h}"
    viewBox="0 0 ${def.width} ${def.height}" xmlns="http://www.w3.org/2000/svg">
    ${def.body(color, opts.opacity ?? 1)}
  </svg>`;
}

// ── Traductions (mêmes clés que le pattern MAP_LEGEND_I18N de map.js) ──
const MARKER_SHAPES_I18N = {
  fr: {
    map_shape_pin:     'Goutte',
    map_shape_circle:  'Cercle',
    map_shape_diamond: 'Losange',
    map_shape_shield:  'Bouclier',
    map_shape_banner:  'Bannière',
    map_shape_hexagon: 'Hexagone',
    map_shape_star:    'Étoile',
    map_shape_square:  'Carré',
  },
  en: {
    map_shape_pin:     'Pin',
    map_shape_circle:  'Circle',
    map_shape_diamond: 'Diamond',
    map_shape_shield:  'Shield',
    map_shape_banner:  'Banner',
    map_shape_hexagon: 'Hexagon',
    map_shape_star:    'Star',
    map_shape_square:  'Square',
  },
};
Object.keys(MARKER_SHAPES_I18N).forEach(lang => {
  if (TRANSLATIONS[lang]) Object.assign(TRANSLATIONS[lang], MARKER_SHAPES_I18N[lang]);
});
