// ══════════════════════════════════════════════════════════════
// Camply — Administration des cartes (Configuration > Cartes)
// Dépend de : supabase-client.js, map-config.js, map.js, scripts.js
// ══════════════════════════════════════════════════════════════

let mapAdminMaps       = [];   // liste des cartes de l'univers courant (cache pour la vue Configuration)
let mapAdminEditingId  = null; // id de la carte en cours d'édition, null = création
let mapAdminState      = {     // état du formulaire (modale ouverte)
  name: '',
  image_url: '',
  image_width: 0,
  image_height: 0,
  colorLabels: {}, // hex → libellé
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
  container.innerHTML = maps.map(m => `
    <div class="map-admin-row">
      <img class="map-admin-thumb" src="${esc(m.image_url)}" alt="">
      <div class="map-admin-row-info">
        <div class="map-admin-row-name">${esc(m.name)}</div>
        <div class="map-admin-row-meta">${m.image_width} × ${m.image_height} px</div>
      </div>
      <div class="map-admin-row-actions">
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

// ── Modale ajout / édition ──────────────────────────────────────

function openMapAdminForm(mapId) {
  if (!canConfigureUniverse()) return;
  const existing = mapId ? mapAdminMaps.find(m => m.id === mapId) : null;
  mapAdminEditingId = existing ? existing.id : null;
  mapAdminState = {
    name:         existing?.name         || '',
    image_url:    existing?.image_url    || '',
    image_width:  existing?.image_width  || 0,
    image_height: existing?.image_height || 0,
    colorLabels:  Object.fromEntries((existing?.marker_colors || []).map(mc => [mc.color, mc.label])),
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
  container.innerHTML = MAP_CONFIG.markerColors.map(c => `
    <div class="map-admin-color-row">
      <span class="map-admin-color-dot" style="background:${c}"></span>
      <input type="text" maxlength="40"
        value="${esc(mapAdminState.colorLabels[c] || '')}"
        placeholder="${t('map_admin_color_ph')}"
        oninput="mapAdminState.colorLabels['${c}'] = this.value">
    </div>`).join('');
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
  const oldUrl = mapAdminState.image_url || '';
  const path   = `${currentUniverse.id}/${mapAdminEditingId || ('tmp_' + Date.now())}.jpg`;
  const { blob, width, height } = await compressMapImage(file);
  const { error } = await sb.storage
    .from('map-images').upload(path, blob, { upsert: true, contentType: 'image/jpeg' });
  document.getElementById('map-admin-illus-uploading').classList.remove('active');
  if (error) { showToast(t('toast_map_image_upload_error') + error.message); return; }
  if (oldUrl && !oldUrl.includes(path)) await deleteMapStorageFile(oldUrl);

  const { data } = sb.storage.from('map-images').getPublicUrl(path);
  mapAdminState.image_url    = `${data.publicUrl}?v=${Date.now()}`;
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
  await deleteMapStorageFile(mapAdminState.image_url);
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

  const marker_colors = MAP_CONFIG.markerColors.map(c => ({
    color: c,
    label: (mapAdminState.colorLabels[c] || '').trim(),
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
    ({ error } = await sb.from('maps').insert({
      ...payload,
      universe_id: currentUniverse.id,
      created_by:  currentUser.id,
    }));
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
