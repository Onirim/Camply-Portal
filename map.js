// ══════════════════════════════════════════════════════════════
// Camply — Module Carte v3 (multi-cartes)
// Dépend de : supabase-client.js, map-config.js, scripts.js
// ══════════════════════════════════════════════════════════════

// ── État ──────────────────────────────────────────────────────
let currentMapKey     = null; // clé de la carte affichée
let mapMarkers        = {};   // id → marker (propres, carte courante seulement)
let mapFollowedLayers = {};   // layerId → { layer, markers: {id→marker} }
let mapOwnLayers      = {};   // map_key → layer
let mapLoaded         = false;
let mapAccessByKey    = {};
let mapColorFilter = {};   // mapKey → Set des couleurs masquées

// Configuration des cartes (chargée depuis public.maps, univers courant).
// Chaque entrée : { key, name, image, imageWidth, imageHeight, markerColorLabels, markerColorShapes, markerColorIcons }
let mapsConfig       = [];
let mapsConfigLoaded = false;

/** Charge (ou recharge) la liste des cartes de l'univers courant depuis la DB. */
async function _loadMapsConfig() {
  if (!currentUniverse) { mapsConfig = []; return; }
  const { data, error } = await sb.from('maps')
    .select('id, map_key, name, image_url, image_width, image_height, marker_colors, sort_order')
    .eq('universe_id', currentUniverse.id)
    .order('sort_order', { ascending: true })
    .order('created_at', { ascending: true });
  if (error) { console.error('Erreur chargement cartes:', error); mapsConfig = []; return; }
  mapsConfig = (data || []).map(row => ({
    id:          row.id,
    key:         row.map_key,
    name:        row.name,
    image:       row.image_url,
    imageWidth:  row.image_width,
    imageHeight: row.image_height,
    markerColorLabels: Object.fromEntries((row.marker_colors || []).map(mc => [mc.color, mc.label])),
    markerColorShapes: Object.fromEntries((row.marker_colors || []).map(mc => [mc.color, mc.shape || MARKER_SHAPE_DEFAULT])),
    markerColorIcons:  Object.fromEntries((row.marker_colors || []).map(mc => [mc.color, mc.icon || ''])),
  }));
  mapsConfigLoaded = true;
}

/** Réinitialise entièrement l'état du module carte (appelé lors d'un changement d'univers, pour éviter d'afficher les cartes/marqueurs de l'univers précédent). */
function resetMapState() {
  currentMapKey     = null;
  mapMarkers        = {};
  mapFollowedLayers = {};
  mapOwnLayers      = {};
  mapAccessByKey    = {};
  mapColorFilter    = {};
  mapsConfig        = [];
  mapsConfigLoaded  = false;
  mapLoaded         = false;
  _closePopup();
  document.querySelector('.map-selector-wrap')?.remove();
  if (_mapCanvas) {
    _mapCanvas.querySelector('img.map-image')?.remove();
    _mapCanvas.querySelector('.map-image-error')?.remove();
  }
  _mapImage = null;
}

/** Recharge la config des cartes et met à jour l'affichage courant (appelé après un ajout/édition/suppression dans Configuration > Cartes). */
async function refreshMapsConfigAndRerender() {
  await _loadMapsConfig();
  _recomputeMapAccess();
  if (!mapLoaded) return;
  _buildMapSelector();
  _refreshMapSelectorAccess();

  if (!mapsConfig.some(m => m.key === currentMapKey)) {
    currentMapKey = _firstAccessibleMapKey();
  }
  _closePopup();
  const oldImg = _mapCanvas?.querySelector('img.map-image');
  if (oldImg) oldImg.remove();
  const oldErr = _mapCanvas?.querySelector('.map-image-error');
  if (oldErr) oldErr.remove();
  _mapImage = null;
  if (currentMapKey) _buildMapImage();
  _renderAllMarkers();
  _renderVisibilityToggle();
  _renderMapAccessState();
  _renderMapLegend();
}

// Transformation courante
let mapTransform = { x: 0, y: 0, scale: 1 };

// État du drag (pan)
let mapDrag = { active: false, startX: 0, startY: 0, originX: 0, originY: 0, moved: false };

// Popup ouverte : { id, owned } | null
let mapOpenPopup = null;

// Modale marqueur
let mapModalCtx   = null;
let mapModalColor = null;

// Références DOM
let _mapViewport = null;
let _mapCanvas   = null;
let _mapImage    = null;

// ── Helpers config ────────────────────────────────────────────

/** Retourne la config de la carte actuellement affichée. */
function _getCurrentMapConfig() {
  const maps = mapsConfig || [];
  return maps.find(m => m.key === currentMapKey) || maps[0] || null;
}

/** Retourne la couche (layer) de l'utilisateur pour la carte courante. */
function _ownLayer() {
  return mapOwnLayers[currentMapKey] || null;
}


function _normalizeMapKey(mapKey) {
  return mapKey || 'default';
}

function _getCurrentColorLabels() {
  const cfg = _getCurrentMapConfig();
  return cfg?.markerColorLabels || {};
}

function _getCurrentColorShapes() {
  const cfg = _getCurrentMapConfig();
  return cfg?.markerColorShapes || {};
}

function _getMarkerShapeForColor(color) {
  return _getCurrentColorShapes()[color] || MARKER_SHAPE_DEFAULT;
}

function _getCurrentColorIcons() {
  const cfg = _getCurrentMapConfig();
  return cfg?.markerColorIcons || {};
}

function _getMarkerIconForColor(color) {
  return _getCurrentColorIcons()[color] || '';
}

function _getHiddenColorsSet(mapKey = currentMapKey) {
  if (!mapColorFilter[mapKey]) mapColorFilter[mapKey] = new Set();
  return mapColorFilter[mapKey];
}

function _isColorVisible(color) {
  return !_getHiddenColorsSet().has(color);
}

// Couleurs réellement affichables dans la légende : uniquement
// celles qui ont un libellé non vide pour la carte courante.
function _getLegendColors() {
  const labels = _getCurrentColorLabels();
  return (MAP_CONFIG.markerColors || []).filter(c => (labels[c] || '').trim());
}

function toggleMapColorFilter(color) {
  const hidden = _getHiddenColorsSet();
  if (hidden.has(color)) hidden.delete(color);
  else hidden.add(color);
  _renderMapLegend();
  _renderAllMarkers();
}

function resetMapColorFilter() {
  _getHiddenColorsSet().clear();
  _renderMapLegend();
  _renderAllMarkers();
}

function _renderMapLegend() {
  const panel = document.getElementById('map-legend-panel');
  const btn   = document.getElementById('map-legend-btn');
  if (!panel) return;

  const labels = _getCurrentColorLabels();
  const shapes = _getCurrentColorShapes();
  const icons  = _getCurrentColorIcons();
  const hidden = _getHiddenColorsSet();
  const colors = _getLegendColors();

  // Pas de couleur libellée pour cette carte → on cache le bouton
  if (btn) btn.style.display = colors.length ? 'flex' : 'none';

  if (!colors.length) {
    panel.classList.remove('open');
    panel.innerHTML = '';
    if (btn) btn.classList.remove('active');
    return;
  }

  const anyHidden = colors.some(c => hidden.has(c));

  panel.innerHTML = `
    <div class="map-legend-header">
      <div class="map-legend-title">${t('map_legend_title')}</div>
      <button class="map-legend-reset" onclick="resetMapColorFilter()"
        style="${anyHidden ? '' : 'display:none'}">${t('map_legend_reset')}</button>
    </div>
    <div class="map-legend-list">
      ${colors.map(c => `
        <div class="map-legend-item ${hidden.has(c) ? 'off' : ''}" onclick="toggleMapColorFilter('${c}')">
          <span class="map-legend-dot">${markerShapeSVG(shapes[c], c, 12, { icon: icons[c] })}</span>
          <span class="map-legend-label">${esc(labels[c])}</span>
          <span class="map-legend-check">
            <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2" width="11" height="11">
              <polyline points="2,8 6,12 14,4"/>
            </svg>
          </span>
        </div>`).join('')}
    </div>`;
}

// ── Libellés permanents ───────────────────────────────────────
let mapLabelsVisible = false;

function toggleMapLabels() {
  mapLabelsVisible = !mapLabelsVisible;
  if (_mapViewport) _mapViewport.classList.toggle('labels-visible', mapLabelsVisible);
  const btn = document.getElementById('map-labels-btn');
  if (btn) btn.classList.toggle('active', mapLabelsVisible);
}

function toggleMapLegendPanel() {
  const panel = document.getElementById('map-legend-panel');
  const btn   = document.getElementById('map-legend-btn');
  if (!panel) return;
  const open = panel.classList.toggle('open');
  if (btn) btn.classList.toggle('active', open);
}

function _isMarkerOnCurrentMap(marker) {
  return _normalizeMapKey(marker?.map_key) === currentMapKey;
}

function _recomputeMapAccess() {
  const keys = (mapsConfig || []).map(m => m.key);
  // Le propriétaire de l'univers a accès à toutes les cartes,
  // y compris celles dont aucune couche n'est partagée avec lui.
  const canSeeAll = currentUniverse?.role === 'owner';
  mapAccessByKey = {};

  if (canSeeAll) {
    keys.forEach(k => { mapAccessByKey[k] = true; });
    return;
  }

  const granted = new Set();
  Object.keys(mapOwnLayers || {}).forEach(k => granted.add(_normalizeMapKey(k)));
  Object.values(mapFollowedLayers || {}).forEach(({ layer }) => {
    granted.add(_normalizeMapKey(layer?.map_key));
  });
  keys.forEach(k => { mapAccessByKey[k] = granted.has(_normalizeMapKey(k)); });
}

function _canAccessMap(mapKey = currentMapKey) {
  return !!mapAccessByKey[_normalizeMapKey(mapKey)];
}

function _firstAccessibleMapKey() {
  const maps = mapsConfig || [];
  const first = maps.find(m => _canAccessMap(m.key));
  return first?.key || null;
}

function _renderMapAccessState() {
  if (!_mapViewport) return;
  let msg = document.getElementById('map-no-access');
  if (!msg) {
    msg = document.createElement('div');
    msg.id = 'map-no-access';
    msg.className = 'map-no-access';
    _mapViewport.appendChild(msg);
  }
  msg.textContent = t('map_access_denied');
  msg.style.display = _canAccessMap() ? 'none' : 'flex';

  const markerCount = document.getElementById('map-marker-count');
  if (markerCount && !_canAccessMap()) {
    markerCount.innerHTML = ti('map_marker_count_many', { n: 0 });
  }
}

// ══════════════════════════════════════════════════════════════
// INIT
// ══════════════════════════════════════════════════════════════

async function initMap() {
  await _loadMapsConfig();
  const maps = mapsConfig || [];
  if (!maps.length) return;

  _mapViewport = document.getElementById('map-viewport');
  _mapCanvas   = document.getElementById('map-canvas');

  if (mapLoaded) return; // déjà initialisé, les événements sont en place

  if (!currentMapKey) currentMapKey = maps[0].key;

  _buildMapSelector();
  _bindMapEvents();

  await loadAllOwnLayersFromDB(); // charge aussi les couches suivies

  _recomputeMapAccess();
  const fallbackMap = _firstAccessibleMapKey();
  if (!_canAccessMap(currentMapKey) && fallbackMap) {
    currentMapKey = fallbackMap;
  }

  await loadMapMarkersFromDB();
  _refreshMapSelectorAccess();
  _buildMapImage();

  _renderAllMarkers();
  _renderVisibilityToggle();
  _renderMapAccessState();
  _renderMapLegend();
  mapLoaded = true;
}

// ── Partage / navigation par lien ────────────────────────────

/** Copie un lien de partage vers la carte actuellement affichée. */
function shareMapBtn() {
  const cfg = _getCurrentMapConfig();
  if (!cfg?.id) return;
  copyUrl(buildShareUrl('map', cfg.id));
}

/** Ouvre la vue Carte sur une carte précise une fois celle-ci chargée. */
function _openMapById(mapKey, id) {
  showView('map');
  const trySwitch = () => {
    if (!mapLoaded) return false;
    if (mapKey !== currentMapKey) switchMap(mapKey);
    setHash('map', id);
    return true;
  };
  if (trySwitch()) return;
  const wait = setInterval(() => { if (trySwitch()) clearInterval(wait); }, 100);
  setTimeout(() => clearInterval(wait), 5000);
}

/** Navigue vers une carte à partir de son id (lien de partage, marqueur lié). */
function navigateToMap(id) {
  if (!id) return false;
  const known = (mapsConfig || []).find(m => m.id === id);
  if (known) { _openMapById(known.key, known.id); return true; }
  sb.from('maps')
    .select('id, map_key, name, universe_id')
    .eq('id', id).single()
    .then(async ({ data: row, error }) => {
      if (error || !row) { showToast(t('toast_map_not_found')); if (currentUniverse) showView('map'); else showUniverseScreen(); return; }
      const switched = await switchUniverseIfNeeded(row.universe_id);
      if (switched === 'not_member') { showToast(t('toast_map_not_found')); showUniverseScreen(); return; }
      if (switched) return;
      _openMapById(row.map_key, row.id);
    });
  return true;
}

// ── Sélecteur de carte ────────────────────────────────────────

function _buildMapSelector() {
  const maps = mapsConfig || [];
  if (maps.length <= 1) return; // pas de sélecteur pour une seule carte

  const toolbar = document.querySelector('.map-toolbar');
  if (!toolbar || document.getElementById('map-selector')) return;

  const wrap = document.createElement('div');
  wrap.className = 'map-selector-wrap';

  const lbl = document.createElement('span');
  lbl.className = 'map-selector-label';
  lbl.textContent = t('map_selector_label');
  wrap.appendChild(lbl);

  const sel = document.createElement('select');
  sel.id = 'map-selector';
  sel.className = 'map-selector';
  sel.addEventListener('change', () => switchMap(sel.value));

  wrap.appendChild(sel);
  toolbar.insertBefore(wrap, toolbar.firstChild);
  _refreshMapSelectorAccess();
}

function _refreshMapSelectorAccess() {
  const sel = document.getElementById('map-selector');
  if (!sel) return;
  const maps = mapsConfig || [];
  const accessibleMaps = maps.filter(m => _canAccessMap(m.key));
  const previous = currentMapKey;

  sel.innerHTML = '';
  for (const m of accessibleMaps) {
    const opt = document.createElement('option');
    opt.value = m.key;
    opt.textContent = m.name;
    sel.appendChild(opt);
  }

  if (!accessibleMaps.length) {
    sel.disabled = true;
    return;
  }

  sel.disabled = false;
  currentMapKey = accessibleMaps.some(m => m.key === previous)
    ? previous
    : accessibleMaps[0].key;
  sel.value = currentMapKey;
}

function _ensureCurrentMapImage() {
  if (!_canAccessMap()) return;
  const hasImage = !!_mapCanvas?.querySelector('img.map-image');
  if (!hasImage) _buildMapImage();
}

/** Bascule vers une autre carte. */
async function switchMap(key) {
  if (!key || key === currentMapKey) return;
  if (!_canAccessMap(key)) {
    showToast(t('map_toast_map_locked'));
    const selGuard = document.getElementById('map-selector');
    if (selGuard) selGuard.value = currentMapKey;
    return;
  }
  currentMapKey = key;

  // Synchronise le sélecteur
  const sel = document.getElementById('map-selector');
  if (sel) sel.value = key;

  // Efface l'image et les marqueurs actuels
  _closePopup();
  _mapViewport.querySelectorAll('.map-marker').forEach(el => el.remove());
  const oldImg = _mapCanvas.querySelector('img.map-image');
  if (oldImg) oldImg.remove();
  const oldErr = _mapCanvas.querySelector('.map-image-error');
  if (oldErr) oldErr.remove();
  _mapImage = null;

  // Construit la nouvelle image
  _buildMapImage();

  // Recharge les marqueurs propres pour la nouvelle carte
  await loadMapMarkersFromDB();

  // Ré-affiche les marqueurs suivis (filtrés par la nouvelle carte)
  Object.values(mapFollowedLayers).forEach(({ layer, markers }) => {
    if (_normalizeMapKey(layer.map_key) !== currentMapKey) return;
    Object.values(markers)
      .filter(m => _isMarkerOnCurrentMap(m))
      .forEach(m => _renderMarker(m, false));
  });

  // Ré-affiche les marqueurs propres
  Object.values(mapMarkers).filter(m => _isMarkerOnCurrentMap(m)).forEach(m => _renderMarker(m, true));
  _updateMarkerCount();

  _renderVisibilityToggle();
  _renderMapAccessState();
  _renderMapLegend();
}

// ── Construction de l'image ───────────────────────────────────

function _buildMapImage() {
  const cfg = _getCurrentMapConfig();
  if (!cfg) return;
  if (!_canAccessMap()) {
    _renderMapAccessState();
    return;
  }

  const img = document.createElement('img');
  img.id = 'map-image'; img.className = 'map-image';
  img.alt = cfg.name || t('map_selector_label'); img.draggable = false;
  img.onload = () => {
    _mapImage = img;
    _setInitialTransform();
    _renderAllMarkers();
    _updateZoomDisplay();
  };
  img.onerror = () => {
    const err = document.createElement('div');
    err.className = 'map-image-error';
    err.innerHTML = `<div class="icon">🗺️</div>
      <strong>${t('map_image_error')}</strong>
      <code>${cfg.image}</code>`;
    _mapCanvas.appendChild(err);
  };
  img.src = cfg.image;
  _mapCanvas.appendChild(img);
}

// ══════════════════════════════════════════════════════════════
// TRANSFORM — ZOOM & PAN
// ══════════════════════════════════════════════════════════════

function _setInitialTransform() {
  const cfg = _getCurrentMapConfig();
  if (!_mapViewport || !_mapImage || !cfg) return;
  const vw = _mapViewport.clientWidth, vh = _mapViewport.clientHeight;
  const iw = cfg.imageWidth, ih = cfg.imageHeight;
  let scale = MAP_CONFIG.zoomInitial === 'fit'
    ? Math.max(MAP_CONFIG.zoomMin, Math.min(MAP_CONFIG.zoomMax, Math.min(vw / iw, vh / ih) * 0.92))
    : (parseFloat(MAP_CONFIG.zoomInitial) || 1);
  mapTransform.scale = scale;
  mapTransform.x = (vw - iw * scale) / 2;
  mapTransform.y = (vh - ih * scale) / 2;
  _applyTransform();
}

function _applyTransform() {
  if (!_mapCanvas) return;
  _mapCanvas.style.transform =
    `translate(${mapTransform.x}px, ${mapTransform.y}px) scale(${mapTransform.scale})`;
  _repositionRenderedMarkers();
}

function _updateZoomDisplay() {
  const el = document.getElementById('map-zoom-value');
  if (el) el.textContent = Math.round(mapTransform.scale * 100) + '%';
}

function _clampTransform() {
  const cfg = _getCurrentMapConfig();
  if (!_mapImage || !cfg) return;
  const vw = _mapViewport.clientWidth, vh = _mapViewport.clientHeight;
  const iw = cfg.imageWidth * mapTransform.scale;
  const ih = cfg.imageHeight * mapTransform.scale;
  const m = 60;
  mapTransform.x = Math.min(vw - m, Math.max(m - iw, mapTransform.x));
  mapTransform.y = Math.min(vh - m, Math.max(m - ih, mapTransform.y));
}

function _zoomAt(cx, cy, newScale) {
  newScale = Math.max(MAP_CONFIG.zoomMin, Math.min(MAP_CONFIG.zoomMax, newScale));
  const r = newScale / mapTransform.scale;
  mapTransform.x = cx - r * (cx - mapTransform.x);
  mapTransform.y = cy - r * (cy - mapTransform.y);
  mapTransform.scale = newScale;
  _clampTransform(); _applyTransform(); _updateZoomDisplay(); _repositionPopup();
}

function mapZoomIn()    { const c = _vc(); _zoomAt(c.x, c.y, mapTransform.scale + MAP_CONFIG.zoomStep); }
function mapZoomOut()   { const c = _vc(); _zoomAt(c.x, c.y, mapTransform.scale - MAP_CONFIG.zoomStep); }
function mapZoomReset() { _setInitialTransform(); _updateZoomDisplay(); _closePopup(); }
function _vc()          { return { x: _mapViewport.clientWidth / 2, y: _mapViewport.clientHeight / 2 }; }

// viewport px → position relative image [0,1]
function _v2m(cx, cy) {
  const cfg = _getCurrentMapConfig();
  const r = _mapViewport.getBoundingClientRect();
  return {
    x: (cx - r.left - mapTransform.x) / mapTransform.scale / cfg.imageWidth,
    y: (cy - r.top  - mapTransform.y) / mapTransform.scale / cfg.imageHeight,
  };
}
// position relative [0,1] → coordonnées canvas px
function _m2c(rx, ry) {
  const cfg = _getCurrentMapConfig();
  return { x: rx * cfg.imageWidth, y: ry * cfg.imageHeight };
}

// ══════════════════════════════════════════════════════════════
// EVENTS
// ══════════════════════════════════════════════════════════════

function _bindMapEvents() {
  const vp = _mapViewport;

  vp.addEventListener('wheel', e => {
    if (!_canAccessMap()) return;
    e.preventDefault();
    const r = vp.getBoundingClientRect();
    _zoomAt(e.clientX - r.left, e.clientY - r.top,
            mapTransform.scale * (e.deltaY < 0 ? 1.1 : 0.9));
  }, { passive: false });

  let _pinch = null;
  vp.addEventListener('touchstart', e => {
    if (e.touches.length === 2) _pinch = _pinchDist(e);
  }, { passive: true });
  vp.addEventListener('touchmove', e => {
    if (e.touches.length === 2 && _pinch !== null) {
      const d = _pinchDist(e), rect = vp.getBoundingClientRect();
      const cx = (e.touches[0].clientX + e.touches[1].clientX) / 2 - rect.left;
      const cy = (e.touches[0].clientY + e.touches[1].clientY) / 2 - rect.top;
      _zoomAt(cx, cy, mapTransform.scale * (d / _pinch));
      _pinch = d; e.preventDefault();
    }
  }, { passive: false });
  vp.addEventListener('touchend', () => { _pinch = null; });

  vp.addEventListener('mousedown', e => {
    if (!_canAccessMap()) return;
    const popup = document.getElementById('map-popup');
    if (popup && !popup.contains(e.target)) _closePopup();
    if (e.shiftKey && e.button === 0) {
      e.preventDefault();
      const pos = _v2m(e.clientX, e.clientY);
      openMapMarkerModal('add', pos.x, pos.y);
      return;
    }
    if (e.button === 0) {
      Object.assign(mapDrag, {
        active: true, moved: false,
        startX: e.clientX, startY: e.clientY,
        originX: mapTransform.x, originY: mapTransform.y,
      });
    }
  });

  window.addEventListener('mousemove', e => {
    if (!mapDrag.active) return;
    const dx = e.clientX - mapDrag.startX, dy = e.clientY - mapDrag.startY;
    if (Math.abs(dx) > 3 || Math.abs(dy) > 3) mapDrag.moved = true;
    mapTransform.x = mapDrag.originX + dx;
    mapTransform.y = mapDrag.originY + dy;
    _clampTransform(); _applyTransform(); _repositionPopup();
  });
  window.addEventListener('mouseup', () => { mapDrag.active = false; });

  let _touch = null;
  let _longPressTimer = null;
  const LONG_PRESS_MS = 550;
  const LONG_PRESS_MOVE_TOLERANCE = 10;

  function _clearLongPress() {
    clearTimeout(_longPressTimer);
    _longPressTimer = null;
  }

  vp.addEventListener('touchstart', e => {
    if (e.touches.length === 1) {
      const { clientX: x, clientY: y } = e.touches[0];
      _touch = { x, y, ox: mapTransform.x, oy: mapTransform.y };
      _clearLongPress();
      if (_canAccessMap()) {
        _longPressTimer = setTimeout(() => {
          _longPressTimer = null;
          _touch = null; // annule le pan en cours : c'était un appui long
          if (navigator.vibrate) navigator.vibrate(15);
          const popup = document.getElementById('map-popup');
          if (popup) _closePopup();
          const pos = _v2m(x, y);
          openMapMarkerModal('add', pos.x, pos.y);
        }, LONG_PRESS_MS);
      }
    }
  }, { passive: true });
  vp.addEventListener('touchmove', e => {
    if (!_canAccessMap()) return;
    if (e.touches.length === 1 && _touch) {
      if (_longPressTimer &&
          (Math.abs(e.touches[0].clientX - _touch.x) > LONG_PRESS_MOVE_TOLERANCE ||
           Math.abs(e.touches[0].clientY - _touch.y) > LONG_PRESS_MOVE_TOLERANCE)) {
        _clearLongPress();
      }
      e.preventDefault();
      mapTransform.x = _touch.ox + e.touches[0].clientX - _touch.x;
      mapTransform.y = _touch.oy + e.touches[0].clientY - _touch.y;
      _clampTransform(); _applyTransform();
    }
  }, { passive: false });
  vp.addEventListener('touchend', () => { _touch = null; _clearLongPress(); });

  window.addEventListener('resize', () => {
    if (mapLoaded) { _clampTransform(); _applyTransform(); }
  });
}

function _pinchDist(e) {
  const dx = e.touches[0].clientX - e.touches[1].clientX;
  const dy = e.touches[0].clientY - e.touches[1].clientY;
  return Math.sqrt(dx * dx + dy * dy);
}

// ══════════════════════════════════════════════════════════════
// DB — MARQUEURS PROPRES
// ══════════════════════════════════════════════════════════════

/** Charge les marqueurs de l'utilisateur pour la carte courante uniquement. */
async function loadMapMarkersFromDB() {
  if (!currentUser) return;
  if (!_canAccessMap()) {
    mapMarkers = {};
    return;
  }
  const { data, error } = await sb.from('map_markers')
    .select('id, x, y, name, description, color, map_key, linked_type, linked_id')
    .eq('user_id', currentUser.id)
    .eq('map_key', currentMapKey)
    .eq('universe_id', currentUniverse.id)
    .order('created_at', { ascending: true });
  mapMarkers = {};
  if (error) { console.error('Erreur marqueurs:', error); return; }
  (data || []).forEach(m => { mapMarkers[m.id] = { ...m, map_key: _normalizeMapKey(m.map_key) }; });
}

/** Retrouve un marqueur (propre ou dans une couche suivie) et son store d'origine. */
function _findMarkerContext(markerId) {
  if (mapMarkers[markerId]) return { marker: mapMarkers[markerId], own: true };
  for (const entry of Object.values(mapFollowedLayers)) {
    if (entry.markers[markerId]) return { marker: entry.markers[markerId], own: false, followedEntry: entry };
  }
  return null;
}

async function _saveMarkerToDB(payload, ctx) {
  if (ctx.mode === 'add') {
    const { data, error } = await sb.from('map_markers')
      .insert({ ...payload, user_id: currentUser.id, map_key: currentMapKey, universe_id: currentUniverse.id })
      .select('id, x, y, name, description, color, map_key, linked_type, linked_id').single();
    if (error) { showToast(t('map_toast_error')); return; }
    mapMarkers[data.id] = data;
    _renderMarker(data, true);
    _updateMarkerCount();
    showToast(t('map_toast_added'));
  } else {
    // Un MJ peut éditer un marqueur d'une couche suivie qui lui est
    // partagée : on retrouve alors son store d'origine pour ne pas le
    // faire apparaître comme un marqueur possédé.
    const existing = _findMarkerContext(ctx.id);
    const { data, error } = await sb.from('map_markers')
      .update(payload).eq('id', ctx.id).eq('universe_id', currentUniverse.id)
      .select('id, x, y, name, description, color, map_key, linked_type, linked_id').single();
    if (error) { showToast(t('map_toast_error')); return; }
    if (existing && !existing.own) {
      existing.followedEntry.markers[data.id] = data;
    } else {
      mapMarkers[data.id] = data;
    }
    _refreshMarkerDOM(data);
    showToast(t('map_toast_saved'));
  }
}

async function deleteMapMarker(id) {
  if (!confirm(t('map_confirm_delete_marker'))) return;
  const { error } = await sb.from('map_markers').delete().eq('id', id).eq('universe_id', currentUniverse.id);
  if (error) { showToast(t('map_toast_error')); return; }
  delete mapMarkers[id];
  for (const entry of Object.values(mapFollowedLayers)) delete entry.markers[id];
  document.getElementById('marker-' + id)?.remove();
  _updateMarkerCount();
  _closePopup();
  showToast(t('map_toast_deleted'));
}

// ══════════════════════════════════════════════════════════════
// DB — COUCHES PROPRES (une par carte)
// ══════════════════════════════════════════════════════════════

/** Charge toutes les couches (propres + partagées via campagne), toutes cartes confondues. */
async function loadAllOwnLayersFromDB() {
  if (!currentUser) return;
  const { data: layers, error } = await sb.from('map_layers')
    .select('id, is_public, user_id, map_key')
    .eq('universe_id', currentUniverse.id);
  if (error) { console.error('Erreur chargement couches:', error); return; }

  const ownerIds = [...new Set((layers || []).filter(l => l.user_id !== currentUser.id).map(l => l.user_id))];
  let ownerMap = {};
  if (ownerIds.length) {
    const { data: profiles } = await sb.from('profiles').select('id, username').in('id', ownerIds);
    (profiles || []).forEach(p => { ownerMap[p.id] = p.username; });
  }

  mapOwnLayers = {};
  mapFollowedLayers = {};
  for (const layer of (layers || [])) {
    if (layer.user_id === currentUser.id) {
      mapOwnLayers[layer.map_key] = layer;
      continue;
    }
    const { data: markers } = await sb.from('map_markers')
      .select('id, x, y, name, description, color, map_key, linked_type, linked_id')
      .eq('user_id', layer.user_id).eq('universe_id', currentUniverse.id);
    mapFollowedLayers[layer.id] = {
      layer: { ...layer, _owner_name: ownerMap[layer.user_id] || '?' },
      markers: Object.fromEntries((markers || []).map(m => [m.id, { ...m, map_key: _normalizeMapKey(m.map_key) }])),
    };
  }
  _recomputeMapAccess();
}

async function toggleMapLayerPublic() {
  const pub     = !(_ownLayer()?.is_public || false);
  const payload = { is_public: pub };

  const layer = _ownLayer();
  if (layer?.id) {
    const { data, error } = await sb.from('map_layers')
      .update(payload).eq('id', layer.id).eq('universe_id', currentUniverse.id)
      .select('id, is_public, map_key').single();
    if (error) { showToast(t('map_toast_error')); return; }
    mapOwnLayers[data.map_key] = data;
  } else {
    const { data, error } = await sb.from('map_layers')
      .insert({ ...payload, user_id: currentUser.id, map_key: currentMapKey, universe_id: currentUniverse.id })
      .select('id, is_public, map_key').single();
    if (error) { showToast(t('map_toast_error')); return; }
    mapOwnLayers[data.map_key] = data;
  }
  _renderVisibilityToggle();
  _recomputeMapAccess();
  _refreshMapSelectorAccess();
  showToast(pub ? t('map_toast_now_public') : t('map_toast_now_private'));
  _ensureCurrentMapImage();
  _renderMapAccessState();
  showToast(t('map_toast_saved'));
}

/** Précharge les couches carte (propres + partagées) même hors vue Carte. */
async function ensureMapLayersCacheLoaded() {
  await loadAllOwnLayersFromDB();
}

// ══════════════════════════════════════════════════════════════
// RENDU — MARQUEURS
// ══════════════════════════════════════════════════════════════

function _renderAllMarkers() {
  if (!_mapCanvas || !_mapViewport) return;
  _mapViewport.querySelectorAll('.map-marker').forEach(el => el.remove());
  _renderMapAccessState();
  if (!_canAccessMap()) return;

  // Couches suivies en dessous : seulement celles de la carte courante.
  // Un MJ de l'univers peut éditer les marqueurs des couches partagées.
  const canEditShared = isUniverseGM();
  Object.values(mapFollowedLayers).forEach(({ layer, markers }) => {
    if (_normalizeMapKey(layer.map_key) !== currentMapKey) return;
    Object.values(markers)
      .filter(m => _isMarkerOnCurrentMap(m))
      .forEach(m => _renderMarker(m, canEditShared));
  });

  // Marqueurs propres par-dessus (déjà filtrés par loadMapMarkersFromDB)
  Object.values(mapMarkers).filter(m => _isMarkerOnCurrentMap(m)).forEach(m => _renderMarker(m, true));
  _updateMarkerCount();
}

function _renderMarker(m, owned) {
  if (!_mapViewport || !_isMarkerOnCurrentMap(m)) return;
  if (!_isColorVisible(m.color)) return;
  const size = MAP_CONFIG.markerSize;

  const shape = _getMarkerShapeForColor(m.color);
  const el = document.createElement('div');
  el.className = 'map-marker'
    + (getMarkerShapeDef(shape).anchor === 'center' ? ' map-marker--anchor-center' : '');
  el.id        = 'marker-' + m.id;
  el.dataset.rx = String(m.x);
  el.dataset.ry = String(m.y);
  _positionMarkerElement(el, m.x, m.y);

  el.innerHTML = markerShapeSVG(shape, m.color, size,
      { className: 'map-marker-pin', opacity: 0.92, icon: _getMarkerIconForColor(m.color) })
    + `<div class="map-marker-label">${esc(m.name)}</div>`;

  el.addEventListener('click', e => {
    e.stopPropagation();
    if (mapDrag.moved) return;
    _openPopup(m.id, owned);
  });

  _mapViewport.appendChild(el);
}

function _refreshMarkerDOM(m) {
  const el = document.getElementById('marker-' + m.id);
  if (!el) { _renderMarker(m, true); return; }
  // La couleur peut avoir changé, et avec elle la forme associée :
  // on régénère le SVG plutôt que de retoucher le fill.
  const shape = _getMarkerShapeForColor(m.color);
  el.classList.toggle('map-marker--anchor-center', getMarkerShapeDef(shape).anchor === 'center');
  const svg = el.querySelector('svg.map-marker-pin');
  if (svg) svg.outerHTML = markerShapeSVG(shape, m.color, MAP_CONFIG.markerSize,
    { className: 'map-marker-pin', opacity: 0.92, icon: _getMarkerIconForColor(m.color) });
  const label = el.querySelector('.map-marker-label');
  if (label) label.textContent = m.name;
  el.dataset.rx = String(m.x);
  el.dataset.ry = String(m.y);
  _positionMarkerElement(el, m.x, m.y);
}

function _positionMarkerElement(el, rx, ry) {
  const cfg = _getCurrentMapConfig();
  if (!cfg) return;
  const vx = rx * cfg.imageWidth * mapTransform.scale + mapTransform.x;
  const vy = ry * cfg.imageHeight * mapTransform.scale + mapTransform.y;
  el.style.left = vx + 'px';
  el.style.top  = vy + 'px';
}

function _repositionRenderedMarkers() {
  if (!_mapViewport) return;
  _mapViewport.querySelectorAll('.map-marker').forEach(el => {
    const rx = parseFloat(el.dataset.rx);
    const ry = parseFloat(el.dataset.ry);
    if (Number.isFinite(rx) && Number.isFinite(ry)) _positionMarkerElement(el, rx, ry);
  });
}

function _updateMarkerCount() {
  const el = document.getElementById('map-marker-count');
  if (!el) return;
  const own      = Object.values(mapMarkers)
    .filter(m => _isMarkerOnCurrentMap(m) && _isColorVisible(m.color)).length;
  const followed = Object.values(mapFollowedLayers)
    .filter(({ layer }) => _normalizeMapKey(layer.map_key) === currentMapKey)
    .reduce((acc, { markers }) =>
      acc + Object.values(markers)
        .filter(m => _isMarkerOnCurrentMap(m) && _isColorVisible(m.color)).length, 0);
  const total = own + followed;
  el.innerHTML = ti(total === 1 ? 'map_marker_count_one' : 'map_marker_count_many', { n: total });
}

// ══════════════════════════════════════════════════════════════
// POPUP D'INFO
// ══════════════════════════════════════════════════════════════

/** Nom affichable de l'objet lié à un marqueur, si connu localement. */
function _linkedObjectName(type, id) {
  if (type === 'char') return chars[id]?.name || followedChars[id]?.name || null;
  if (type === 'doc')  return documents[id]?.title || followedDocuments[id]?.title || null;
  if (type === 'map')  return (mapsConfig || []).find(m => m.id === id)?.name || null;
  return null;
}

/** Icône affichée devant le lien d'un marqueur, selon le type d'objet lié. */
function _linkedTypeIcon(type) {
  if (type === 'char') return '👤';
  if (type === 'doc')  return '📄';
  if (type === 'map')  return '🗺️';
  return '🔗';
}

/** Ouvre la fiche de l'objet lié à un marqueur et ferme la popup. */
function _openMarkerLinkedObject(type, id) {
  _closePopup();
  if (type === 'char') navigateToChar(id);
  else if (type === 'doc') navigateToDoc(id);
  else if (type === 'map') navigateToMap(id);
}

function _openPopup(markerId, owned) {
  let m = mapMarkers[markerId];
  let ownerName = null;
  if (!m) {
    for (const { layer, markers } of Object.values(mapFollowedLayers)) {
      if (markers[markerId]) { m = markers[markerId]; ownerName = layer._owner_name; break; }
    }
  }
  if (!m) return;
  mapOpenPopup = { id: markerId, owned };

  document.getElementById('map-popup')?.remove();

  const popup = document.createElement('div');
  popup.className = 'map-popup'; popup.id = 'map-popup';

  popup.innerHTML = `
    <div class="map-popup-header">
      <div class="map-popup-color-dot" style="background:${m.color}"></div>
      <div class="map-popup-name">${esc(m.name)}</div>
      <button class="map-popup-close" onclick="_closePopup()">✕</button>
    </div>
    ${m.description ? `<div class="map-popup-desc">${esc(m.description)}</div>` : ''}
    ${m.linked_type && m.linked_id ? `
    <div class="map-popup-link">
      <a href="#" onclick="event.preventDefault(); _openMarkerLinkedObject('${m.linked_type}','${m.linked_id}')">
        ${_linkedTypeIcon(m.linked_type)} ${esc(_linkedObjectName(m.linked_type, m.linked_id) || t('map_popup_link_' + m.linked_type))}
      </a>
    </div>` : ''}
    ${ownerName ? `<div class="map-popup-owner">${t('followed_owner_prefix')}${esc(ownerName)}</div>` : ''}
    ${owned ? `
    <div class="map-popup-actions">
      <button class="map-popup-edit-btn"
        onclick="openMapMarkerModal('edit',null,null,'${markerId}')">
        <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5"
          width="11" height="11"><path d="M11 2l3 3-9 9H2v-3z"/></svg>
        ${t('btn_edit')}
      </button>
      <button class="map-popup-delete-btn" onclick="deleteMapMarker('${markerId}')">
        <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5"
          width="11" height="11">
          <polyline points="3,4 13,4"/>
          <path d="M5 4V2h6v2M6 7v5M10 7v5"/>
          <path d="M4 4l1 10h6l1-10"/>
        </svg>
        ${t('btn_delete')}
      </button>
    </div>` : ''}`;

  _mapViewport.appendChild(popup);
  _repositionPopupOn(markerId, popup);
}

function _repositionPopup() {
  if (!mapOpenPopup) return;
  const popup = document.getElementById('map-popup');
  if (popup) _repositionPopupOn(mapOpenPopup.id, popup);
}

function _repositionPopupOn(markerId, popup) {
  if (window.matchMedia('(max-width: 768px)').matches) return; // pleine écran, fixée par CSS
  let m = mapMarkers[markerId];
  if (!m) {
    for (const { markers } of Object.values(mapFollowedLayers)) {
      if (markers[markerId]) { m = markers[markerId]; break; }
    }
  }
  if (!m) return;
  const { x: cx, y: cy } = _m2c(m.x, m.y);
  const vx = cx * mapTransform.scale + mapTransform.x;
  const vy = cy * mapTransform.scale + mapTransform.y;
  const pw = popup.offsetWidth || 240, ph = popup.offsetHeight || 120;
  const vw = _mapViewport.clientWidth, vh = _mapViewport.clientHeight;
  let left = vx - pw / 2;
  let top  = vy - MAP_CONFIG.markerSize * 1.4 - ph - 8;
  if (left < 8)       left = 8;
  if (left + pw > vw) left = vw - pw - 8;
  if (top  < 8)       top  = vy + MAP_CONFIG.markerSize + 8;
  popup.style.left = left + 'px';
  popup.style.top  = top  + 'px';
}

function _closePopup() {
  document.getElementById('map-popup')?.remove();
  mapOpenPopup = null;
}

// ══════════════════════════════════════════════════════════════
// MODALE MARQUEUR
// ══════════════════════════════════════════════════════════════

function openMapMarkerModal(mode, rx, ry, markerId) {
  mapModalCtx = { mode, x: rx, y: ry, id: markerId };
  const m = (mode === 'edit' && markerId) ? _findMarkerContext(markerId)?.marker : null;

  // Seules les couleurs libellées par le propriétaire de l'univers (visibles
  // dans la légende) sont proposées à la création/édition d'un marqueur.
  const labels        = _getCurrentColorLabels();
  const allowedColors = _getLegendColors();
  mapModalColor = (m?.color && allowedColors.includes(m.color)) ? m.color : (allowedColors[0] || null);

  document.getElementById('map-modal-title-text').textContent =
    mode === 'add' ? t('map_modal_new_marker') : t('map_modal_edit_marker');
  document.getElementById('map-modal-name').value = m?.name        || '';
  document.getElementById('map-modal-desc').value = m?.description || '';

  const swatchesEl = document.getElementById('map-modal-swatches');
  const saveBtn    = document.getElementById('map-modal-save-btn');
  if (!allowedColors.length) {
    swatchesEl.innerHTML = `<div class="map-modal-no-colors">${t('map_modal_no_colors')}</div>`;
    if (saveBtn) saveBtn.disabled = true;
  } else {
    const shapes = _getCurrentColorShapes();
    const icons  = _getCurrentColorIcons();
    swatchesEl.innerHTML = allowedColors.map(c => `
      <div class="map-color-swatch ${c === mapModalColor ? 'selected' : ''}"
        title="${esc(labels[c])}" onclick="selectMapModalColor('${c}',this)">${markerShapeSVG(shapes[c], c, 16, { icon: icons[c] })}</div>`
    ).join('');
    if (saveBtn) saveBtn.disabled = false;
  }

  document.getElementById('map-modal-link-type').value = m?.linked_type || '';
  _refreshMapModalLinkOptions(m?.linked_id);

  document.getElementById('map-marker-modal').classList.add('open');
  requestAnimationFrame(() => document.getElementById('map-modal-name').focus());
  _closePopup();
}

/**
 * Personnages/documents que l'utilisateur peut lier à un marqueur : les
 * siens plus tout ce qui lui est visible dans l'univers (RLS), càd les
 * stores `followedChars`/`followedDocuments` déjà filtrés côté serveur
 * selon le partage de campagne et le statut public des objets.
 */
function _universeItemsOfType(type) {
  if (type === 'char') return [
    ...Object.values(chars).map(c => ({ id: c._db_id, name: c.name || '—' })),
    ...Object.values(followedChars).map(c => ({ id: c._db_id, name: `${c.name || '—'} (${c._owner_name})` })),
  ];
  if (type === 'doc') return [
    ...Object.values(documents).map(d => ({ id: d.id, name: d.title || '—' })),
    ...Object.values(followedDocuments).map(d => ({ id: d.id, name: `${d.title || '—'} (${d._owner_name})` })),
  ];
  if (type === 'map') return (mapsConfig || [])
    .filter(m => m.key !== currentMapKey)
    .map(m => ({ id: m.id, name: m.name || '—' }));
  return [];
}

/** Peuple le select d'objets liés selon le type choisi (personnage/document). */
function _refreshMapModalLinkOptions(selectedId) {
  const type = document.getElementById('map-modal-link-type').value;
  const select = document.getElementById('map-modal-link-id');
  if (!type) { select.innerHTML = ''; select.disabled = true; return; }
  const items = _universeItemsOfType(type);
  select.disabled = false;
  select.innerHTML = `<option value="">${t('map_modal_link_select_ph')}</option>` +
    items.map(it => `<option value="${it.id}" ${it.id === selectedId ? 'selected' : ''}>${esc(it.name)}</option>`).join('');
}

function selectMapModalColor(color, el) {
  mapModalColor = color;
  document.querySelectorAll('.map-color-swatch').forEach(s => s.classList.remove('selected'));
  el.classList.add('selected');
}

function closeMapMarkerModal() {
  document.getElementById('map-marker-modal').classList.remove('open');
  mapModalCtx = null;
}

async function submitMapMarkerModal() {
  if (!mapModalColor) return; // aucune couleur libellée disponible pour cette carte
  const name = document.getElementById('map-modal-name').value.trim();
  const desc = document.getElementById('map-modal-desc').value.trim();
  if (!name) { document.getElementById('map-modal-name').focus(); return; }
  const linkType = document.getElementById('map-modal-link-type').value;
  const linkId   = document.getElementById('map-modal-link-id').value;
  const ctx = { ...mapModalCtx };
  const payload = {
    name, description: desc, color: mapModalColor,
    linked_type: linkType && linkId ? linkType : null,
    linked_id:   linkType && linkId ? linkId   : null,
    ...(ctx.mode === 'add' && {
      x: Math.max(0, Math.min(1, ctx.x)),
      y: Math.max(0, Math.min(1, ctx.y)),
    }),
  };
  closeMapMarkerModal();
  await _saveMarkerToDB(payload, ctx);
}

document.addEventListener('keydown', e => {
  const modal = document.getElementById('map-marker-modal');
  if (!modal?.classList.contains('open')) return;
  if (e.key === 'Enter' && !e.shiftKey && e.target.tagName !== 'TEXTAREA') {
    e.preventDefault(); submitMapMarkerModal();
  }
  if (e.key === 'Escape') closeMapMarkerModal();
});

// ══════════════════════════════════════════════════════════════
// SWITCH PUBLIC/PRIVÉ DE LA COUCHE DE MARQUEURS
// ══════════════════════════════════════════════════════════════

function _renderVisibilityToggle() {
  const btn = document.getElementById('map-visibility-btn');
  if (!btn) return;
  const isPublic = _ownLayer()?.is_public || false;
  btn.classList.toggle('public', isPublic);
  btn.querySelector('.pub-toggle-track')?.classList.toggle('on', isPublic);
  btn.title = isPublic ? t('map_visibility_title_public') : t('map_visibility_title_private');
  const label = document.getElementById('map-visibility-label');
  if (label) label.textContent = isPublic ? t('map_public_active') : t('map_public_private');
}

const MAP_LEGEND_I18N = {
  fr: {
    map_legend_btn:   'Légende',
    map_legend_title: 'Filtrer par couleur',
    map_legend_reset: 'Tout afficher',
    map_legend_btn:   'Légende',
    map_labels_btn:   'Libellés',
  },
  en: {
    map_legend_btn:   'Legend',
    map_legend_title: 'Filter by color',
    map_legend_reset: 'Show all',
    map_labels_btn:   'Labels',
  },
};
Object.keys(MAP_LEGEND_I18N).forEach(lang => {
  if (TRANSLATIONS[lang]) Object.assign(TRANSLATIONS[lang], MAP_LEGEND_I18N[lang]);
});
