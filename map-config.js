// ══════════════════════════════════════════════════════════════
// Camply — Réglages globaux de la carte
//
// Les cartes elles-mêmes (image, nom, dimensions, libellés des
// couleurs de marqueurs) ne sont plus définies ici : elles sont
// configurées depuis l'onglet Configuration > Cartes de l'app
// (table public.maps, voir sql/00_fresh_install.sql section
// "sql/23_maps_config.sql"). Ce fichier ne conserve que les
// réglages globaux, indépendants de toute carte précise.
// ══════════════════════════════════════════════════════════════

const MAP_CONFIG = {
  // ── Comportement du zoom ──────────────────────────────────
  zoomMin:     0.15,
  zoomMax:     4.0,
  zoomStep:    0.15,
  zoomInitial: 'fit', // 'fit' = ajuste à la fenêtre, ou nombre (ex: 0.5)

  // ── Apparence des marqueurs ───────────────────────────────
  // Palette fixe partagée par toutes les cartes. Seuls les
  // libellés (noms) attribués à chaque couleur sont configurables
  // par carte, depuis Configuration > Cartes.
  markerSize: 28,
  markerColors: [
    '#e05c5c',
    '#e07a3a',
    '#e8c46a',
    '#5cbf7a',
    '#5c9be0',
    '#9b7de8',
    '#e05c9b',
    '#5cbfbf',
  ],
};
