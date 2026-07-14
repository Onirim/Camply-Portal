// ══════════════════════════════════════════════════════════════
// Camply — Administration des cartes (Configuration > Cartes)
// Dépend de : supabase-client.js, map-config.js, map.js, scripts.js
// ══════════════════════════════════════════════════════════════

let mapAdminMaps       = [];   // liste des cartes de l'univers courant (cache pour la vue Configuration)
let mapAdminEditingId  = null; // id de la carte en cours d'édition, null = création
let mapAdminStaging    = null; // chemin de staging (map-images) en attente de sauvegarde, ou null
let mapAdminState      = {     // état du formulaire (modale ouverte)
  name: '',
  image_url: '',
  image_width: 0,
  image_height: 0,
  colorLabels: {}, // hex → libellé
  colorShapes: {}, // hex → clé de MARKER_SHAPES
  colorIcons:  {}, // hex → clé de MARKER_ICONS ('' = point blanc)
};

// ── Liste ─────────────────────────────────────────────────────

async function loadMapsForConfig() {
  if (!currentUniverse) return;
  const { data, error } = await sb.from('maps')
    .select('id, map_key, name, image_url, image_width, image_height, marker_colors, sort_order')
    .eq('universe_id', currentUniverse.id)
    .order('sort_order', { ascending: true })
    .order('created_at', { ascending: true });
  if (error) { console.error('Erreur chargement cartes (admin):', error); return; }
  mapAdminMaps = data || [];
  renderMapsAdminList(mapAdminMaps);
}

function renderMapsAdminList(maps) {
  const container = document.getElementById('config-maps-list');
  if (!container) return;
  if (!maps.length) {
    container.innerHTML = `<div style="color:var(--text3);font-size:13px;font-style:italic;padding:8px 0">${t('config_maps_empty')}</div>`;
    return;
  }
  container.innerHTML = maps.map((m, i) => `
    <div class="map-admin-row">
      <img class="map-admin-thumb" src="${esc(m.image_url)}" alt="">
      <div class="map-admin-row-info">
        <div class="map-admin-row-name">${esc(m.name)}${i === 0 ? `<span class="map-admin-primary-badge">${t('map_admin_primary_badge')}</span>` : ''}</div>
        <div class="map-admin-row-meta">${m.image_width} × ${m.image_height} px</div>
      </div>
      <div class="map-admin-row-actions">
        <button class="icon-btn" onclick="moveMapAdmin('${m.id}',-1)" title="${t('map_admin_move_up_title')}" ${i === 0 ? 'disabled' : ''}>
          <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" width="12" height="12">
            <polyline points="3,6 8,2 13,6"/><line x1="8" y1="2" x2="8" y2="14"/>
          </svg>
        </button>
        <button class="icon-btn" onclick="moveMapAdmin('${m.id}',1)" title="${t('map_admin_move_down_title')}" ${i === maps.length - 1 ? 'disabled' : ''}>
          <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" width="12" height="12">
            <polyline points="3,10 8,14 13,10"/><line x1="8" y1="14" x2="8" y2="2"/>
          </svg>
        </button>
        <button class="icon-btn" onclick="openMapAdminForm('${m.id}')" title="${t('btn_edit')}">
          <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" width="12" height="12">
            <path d="M11 2l3 3-9 9H2v-3z"/>
          </svg>
        </button>
        <button class="icon-btn danger" onclick="deleteMapAdmin('${m.id}')" title="${t('btn_delete')}">
          <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" width="12" height="12">
            <polyline points="3,4 13,4"/>
            <path d="M5 4V2h6v2M6 7v5M10 7v5"/>
            <path d="M4 4l1 10h6l1-10"/>
          </svg>
        </button>
      </div>
    </div>`).join('');
}

/** Échange la position de deux cartes adjacentes et persiste le nouvel ordre. */
async function moveMapAdmin(mapId, delta) {
  if (!canConfigureUniverse()) return;
  const idx = mapAdminMaps.findIndex(m => m.id === mapId);
  const newIdx = idx + delta;
  if (idx < 0 || newIdx < 0 || newIdx >= mapAdminMaps.length) return;

  [mapAdminMaps[idx], mapAdminMaps[newIdx]] = [mapAdminMaps[newIdx], mapAdminMaps[idx]];
  renderMapsAdminList(mapAdminMaps); // retour visuel immédiat

  const results = await Promise.all(
    mapAdminMaps.map((m, i) => sb.from('maps').update({ sort_order: i }).eq('id', m.id))
  );
  if (results.some(r => r.error)) {
    showToast(t('toast_map_save_error'));
    await loadMapsForConfig();
    return;
  }
  mapAdminMaps.forEach((m, i) => { m.sort_order = i; });
  await refreshMapsConfigAndRerender();
}

// ── Modale ajout / édition ──────────────────────────────────────

function openMapAdminForm(mapId) {
  if (!canConfigureUniverse()) return;
  if (mapAdminStaging) { discardStagedIllustration('map-images', mapAdminStaging); mapAdminStaging = null; }
  const existing = mapId ? mapAdminMaps.find(m => m.id === mapId) : null;
  mapAdminEditingId = existing ? existing.id : null;
  mapAdminState = {
    name:         existing?.name         || '',
    image_url:    existing?.image_url    || '',
    image_width:  existing?.image_width  || 0,
    image_height: existing?.image_height || 0,
    colorLabels:  Object.fromEntries((existing?.marker_colors || []).map(mc => [mc.color, mc.label])),
    colorShapes:  Object.fromEntries((existing?.marker_colors || []).map(mc => [mc.color, mc.shape || MARKER_SHAPE_DEFAULT])),
    colorIcons:   Object.fromEntries((existing?.marker_colors || []).map(mc => [mc.color, mc.icon || ''])),
  };

  document.getElementById('map-admin-modal-title-text').textContent =
    existing ? t('map_admin_modal_title_edit') : t('map_admin_modal_title_new');
  document.getElementById('map-admin-f-name').value = mapAdminState.name;

  setMapAdminImagePreview();
  renderMapAdminColorRows();

  document.getElementById('map-admin-modal').classList.add('open');
  requestAnimationFrame(() => document.getElementById('map-admin-f-name').focus());
}

function closeMapAdminForm() {
  if (mapAdminStaging) { discardStagedIllustration('map-images', mapAdminStaging); mapAdminStaging = null; }
  closeMapAdminMarkerPicker();
  document.getElementById('map-admin-modal').classList.remove('open');
  mapAdminEditingId = null;
}

function setMapAdminImagePreview() {
  const img         = document.getElementById('map-admin-illus-preview-img');
  const placeholder = document.getElementById('map-admin-illus-placeholder');
  const zone        = document.getElementById('map-admin-illus-zone');
  const dims        = document.getElementById('map-admin-dimensions');
  if (mapAdminState.image_url) {
    img.src = mapAdminState.image_url; img.style.display = 'block';
    placeholder.style.display = 'none';
    zone.classList.add('has-image');
  } else {
    img.src = ''; img.style.display = 'none';
    placeholder.style.display = 'flex';
    zone.classList.remove('has-image');
  }
  dims.textContent = (mapAdminState.image_width && mapAdminState.image_height)
    ? ti('map_admin_dimensions', { w: mapAdminState.image_width, h: mapAdminState.image_height })
    : '';
}

function renderMapAdminColorRows() {
  const container = document.getElementById('map-admin-colors');
  if (!container) return;
  container.innerHTML = MAP_CONFIG.markerColors.map(c => {
    const shape = mapAdminState.colorShapes[c] || MARKER_SHAPE_DEFAULT;
    const icon  = mapAdminState.colorIcons[c]  || '';
    return `
    <div class="map-admin-color-row">
      <span class="map-admin-color-dot" style="background:${c}"></span>
      <input type="text" maxlength="40"
        value="${esc(mapAdminState.colorLabels[c] || '')}"
        placeholder="${t('map_admin_color_ph')}"
        oninput="mapAdminState.colorLabels['${c}'] = this.value">
      <button type="button" class="map-admin-custom-btn" title="${t('map_admin_custom_btn')}"
        onmousedown="event.stopPropagation()"
        onclick="openMapAdminMarkerPicker('${c}', this)">
        ${markerShapeSVG(shape, c, 16, { icon })}
      </button>
    </div>`;
  }).join('');
}

// ── Popover de personnalisation du marqueur (forme + pictogramme) ──

function _mapAdminMarkerPickerHTML(color) {
  const shape = mapAdminState.colorShapes[color] || MARKER_SHAPE_DEFAULT;
  const icon  = mapAdminState.colorIcons[color]  || '';
  return `
    <div class="map-admin-picker-preview">${markerShapeSVG(shape, color, 30, { icon })}</div>
    <div class="map-admin-picker-label">${t('map_admin_picker_shape')}</div>
    <div class="map-admin-picker-grid">
      ${MARKER_SHAPE_KEYS.map(s => `
      <button type="button" class="map-admin-picker-choice ${s === shape ? 'selected' : ''}"
        title="${t('map_shape_' + s)}" onclick="setMapAdminShape('${color}','${s}')">
        ${markerShapeSVG(s, color, 14)}
      </button>`).join('')}
    </div>
    <div class="map-admin-picker-label">${t('map_admin_picker_icon')}</div>
    <div class="map-admin-picker-grid">
      <button type="button" class="map-admin-picker-choice ${icon === '' ? 'selected' : ''}"
        title="${t('map_icon_none')}" onclick="setMapAdminIcon('${color}','')">
        <span class="map-admin-icon-dot"></span>
      </button>
      ${MARKER_ICON_KEYS.map(k => `
      <button type="button" class="map-admin-picker-choice ${icon === k ? 'selected' : ''}"
        title="${t('map_icon_' + k)}" onclick="setMapAdminIcon('${color}','${k}')">
        ${markerIconSVG(k, 16)}
      </button>`).join('')}
    </div>`;
}

function openMapAdminMarkerPicker(color, btn) {
  const wasOpen = document.getElementById('map-admin-marker-popover')?.dataset.color === color;
  closeMapAdminMarkerPicker();
  if (wasOpen) return; // re-clic sur le même bouton = fermeture

  const pop = document.createElement('div');
  pop.id = 'map-admin-marker-popover';
  pop.dataset.color = color;
  pop.innerHTML = _mapAdminMarkerPickerHTML(color);
  document.body.appendChild(pop);

  // Position fixe sous le bouton, ramenée dans la fenêtre si besoin
  const r = btn.getBoundingClientRect();
  let left = Math.min(r.left, window.innerWidth - pop.offsetWidth - 8);
  let top  = r.bottom + 4;
  if (top + pop.offsetHeight > window.innerHeight - 8) top = r.top - pop.offsetHeight - 4;
  pop.style.left = Math.max(8, left) + 'px';
  pop.style.top  = Math.max(8, top)  + 'px';

  // Détection du clic extérieur sur mousedown : l'événement précède le
  // remplacement du contenu du popover par les onclick internes, donc
  // la cible est encore attachée au DOM au moment du test.
  document.addEventListener('mousedown', _mapAdminMarkerPickerOutside);
}

function _mapAdminMarkerPickerOutside(e) {
  const pop = document.getElementById('map-admin-marker-popover');
  if (pop && !pop.contains(e.target)) closeMapAdminMarkerPicker();
}

function closeMapAdminMarkerPicker() {
  document.getElementById('map-admin-marker-popover')?.remove();
  document.removeEventListener('mousedown', _mapAdminMarkerPickerOutside);
}

/** Rafraîchit le popover ouvert (après un choix) sans le fermer. */
function _refreshMapAdminMarkerPicker(color) {
  const pop = document.getElementById('map-admin-marker-popover');
  if (pop && pop.dataset.color === color) pop.innerHTML = _mapAdminMarkerPickerHTML(color);
}

function setMapAdminShape(color, shape) {
  mapAdminState.colorShapes[color] = shape;
  _refreshMapAdminMarkerPicker(color);
  renderMapAdminColorRows();
}

function setMapAdminIcon(color, icon) {
  mapAdminState.colorIcons[color] = icon;
  _refreshMapAdminMarkerPicker(color);
  renderMapAdminColorRows();
}

// ── Upload image ─────────────────────────────────────────────

function mapAdminIllusZoneClick() {
  if (!mapAdminState.image_url) document.getElementById('map-admin-illus-input').click();
}

/**
 * Compression dédiée aux cartes : contrairement à compressImage() (portraits,
 * 1200px max / q0.75), les cartes sont vues zoomées : on ne réduit qu'au-delà
 * de 4096px et on encode en JPEG qualité 90%. Retourne aussi les dimensions
 * finales pour remplir automatiquement image_width/image_height.
 */
function compressMapImage(file) {
  return new Promise((resolve) => {
    const MAX    = 4096;
    const reader = new FileReader();
    reader.onload = e => {
      const img  = new Image();
      img.onload = () => {
        let w = img.width, h = img.height;
        if (w > MAX || h > MAX) {
          if (w >= h) { h = Math.round(h * MAX / w); w = MAX; }
          else        { w = Math.round(w * MAX / h); h = MAX; }
        }
        const canvas = document.createElement('canvas');
        canvas.width = w; canvas.height = h;
        canvas.getContext('2d').drawImage(img, 0, 0, w, h);
        canvas.toBlob(blob => resolve({ blob, width: w, height: h }), 'image/jpeg', 0.9);
      };
      img.src = e.target.result;
    };
    reader.readAsDataURL(file);
  });
}

async function uploadMapAdminImage(input) {
  const file = input.files[0];
  if (!file) return;
  if (!currentUser || !currentUniverse) { showToast(t('toast_upload_no_user')); return; }
  if (file.size > 15 * 1024 * 1024) { showToast(t('toast_map_image_too_large')); return; }

  document.getElementById('map-admin-illus-uploading').classList.add('active');
  if (mapAdminStaging) await discardStagedIllustration('map-images', mapAdminStaging);
  const { blob, width, height } = await compressMapImage(file);
  const { path, url, error } = await stageIllustrationUpload('map-images', currentUniverse.id, blob);
  document.getElementById('map-admin-illus-uploading').classList.remove('active');
  if (error) { showToast(t('toast_map_image_upload_error') + error.message); return; }

  mapAdminStaging = path;
  mapAdminState.image_url    = url;
  mapAdminState.image_width  = width;
  mapAdminState.image_height = height;
  setMapAdminImagePreview();
  showToast(t('toast_illus_added'));
  input.value = '';
}

async function deleteMapStorageFile(url) {
  if (!url) return;
  const match = url.match(/map-images\/([^?#]+)/);
  if (match) await sb.storage.from('map-images').remove([match[1]]);
}

async function removeMapAdminImage() {
  if (!mapAdminState.image_url) return;
  if (mapAdminStaging) {
    await discardStagedIllustration('map-images', mapAdminStaging);
    mapAdminStaging = null;
  } else {
    await deleteMapStorageFile(mapAdminState.image_url);
  }
  mapAdminState.image_url    = '';
  mapAdminState.image_width  = 0;
  mapAdminState.image_height = 0;
  setMapAdminImagePreview();
}

// ── Sauvegarde / suppression ────────────────────────────────────

async function saveMapAdmin() {
  if (!canConfigureUniverse() || !currentUniverse) return;
  const name = document.getElementById('map-admin-f-name').value.trim();
  if (!name) {
    showToast(t('toast_map_name_required'));
    document.getElementById('map-admin-f-name').focus();
    return;
  }
  if (!mapAdminState.image_url || !mapAdminState.image_width || !mapAdminState.image_height) {
    showToast(t('toast_map_image_required'));
    return;
  }

  // Une nouvelle carte n'a pas encore d'id : on en génère un côté client
  // pour construire le chemin de storage canonique de l'image AVANT
  // l'insertion (l'id sert aussi ensuite pour l'insert lui-même).
  let targetId = mapAdminEditingId || null;
  if (mapAdminStaging) {
    if (!targetId) targetId = crypto.randomUUID();
    const { url, error: promoteError } = await promoteStagedIllustration(
      'map-images', mapAdminStaging, `${currentUniverse.id}/${targetId}.jpg`, mapAdminState.image_url
    );
    mapAdminState.image_url = url;
    mapAdminStaging = null;
    if (promoteError) showToast(t('toast_illus_upload_error') + promoteError.message);
  }

  const marker_colors = MAP_CONFIG.markerColors.map(c => ({
    color: c,
    label: (mapAdminState.colorLabels[c] || '').trim(),
    shape: mapAdminState.colorShapes[c] || MARKER_SHAPE_DEFAULT,
    icon:  mapAdminState.colorIcons[c]  || '',
  }));

  const payload = {
    name,
    image_url:    mapAdminState.image_url,
    image_width:  mapAdminState.image_width,
    image_height: mapAdminState.image_height,
    marker_colors,
  };

  let error;
  if (mapAdminEditingId) {
    ({ error } = await sb.from('maps').update(payload).eq('id', mapAdminEditingId));
  } else {
    const insertPayload = { ...payload, universe_id: currentUniverse.id, created_by: currentUser.id };
    if (targetId) insertPayload.id = targetId;
    ({ error } = await sb.from('maps').insert(insertPayload));
  }
  if (error) {
    console.error('Erreur sauvegarde carte:', error);
    showToast(t('toast_map_save_error'));
    return;
  }

  closeMapAdminForm();
  await loadMapsForConfig();
  await refreshMapsConfigAndRerender();
  showToast(t('toast_map_saved'));
}

async function deleteMapAdmin(mapId) {
  if (!canConfigureUniverse()) return;
  const map = mapAdminMaps.find(m => m.id === mapId);
  if (!map) return;
  if (!confirm(ti('confirm_delete_map', { name: map.name }))) return;

  const { error } = await sb.from('maps').delete().eq('id', mapId);
  if (error) { showToast(t('toast_map_delete_error')); return; }
  await deleteMapStorageFile(map.image_url);

  await loadMapsForConfig();
  await refreshMapsConfigAndRerender();
  showToast(t('toast_map_deleted'));
}
