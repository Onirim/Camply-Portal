// ══════════════════════════════════════════════════════════════
// Camply TTRPG Manager — Module Campagnes
// Une campagne est une collection d'utilisateurs. Ses membres ont
// accès à tous les objets publics des autres membres de la même
// campagne (visibilité calculée côté RLS, rien à synchroniser ici).
// Seul le propriétaire de l'univers peut créer/gérer des campagnes ;
// il y est automatiquement inscrit.
// ══════════════════════════════════════════════════════════════

// ── État ──────────────────────────────────────────────────────
let campaigns             = {};   // id → campagne { id, title, description, user_id, updated_at, _member_count }
let campaignMembersMap    = {};   // campaignId → [{ user_id, username }]
let universeMemberOptions = [];   // [{ user_id, username }] membres de l'univers hors propriétaire

let activeCampaignId   = null;
let editingCampaignId  = null;
let campaignState      = null;

// Sélection en cours dans l'éditeur : set de user_id cochés
let campaignMemberSelection = new Set();

// Objets publics créés par le MJ (owner/gm de l'univers), groupés par
// type : { character: [{id, label, owner}], chronicle, document, map }
let gmObjectOptions = { character: [], chronicle: [], document: [], map: [] };

// Sélection en cours dans l'éditeur : { character: Set(id), chronicle, document, map }
let campaignObjectSelection = { character: new Set(), chronicle: new Set(), document: new Set(), map: new Set() };

const CAMPAIGN_OBJECT_TABLES = {
  character: { table: 'campaign_visible_characters', col: 'character_id' },
  chronicle: { table: 'campaign_visible_chronicles', col: 'chronicle_id' },
  document:  { table: 'campaign_visible_documents',  col: 'document_id' },
  map:       { table: 'campaign_visible_maps',        col: 'map_layer_id' },
};

function isUniverseOwner() {
  return !!(currentUser && currentUniverse && currentUser.id === currentUniverse.owner_id);
}

// ══════════════════════════════════════════════════════════════
// CHARGEMENT
// ══════════════════════════════════════════════════════════════

async function loadCampaignsFromDB() {
  const { data, error } = await sb
    .from('campaigns')
    .select('id, title, description, user_id, created_at, updated_at')
    .eq('universe_id', currentUniverse.id)
    .order('updated_at', { ascending: false });
  if (error) { console.error('Erreur chargement campagnes:', error); return; }

  campaigns = {};
  (data || []).forEach(r => { campaigns[r.id] = { ...r }; });

  await loadCampaignMemberCounts();
}

async function loadCampaignMemberCounts() {
  const ids = Object.keys(campaigns);
  if (!ids.length) return;
  const { data } = await sb
    .from('campaign_members')
    .select('campaign_id')
    .in('campaign_id', ids);
  const counts = {};
  (data || []).forEach(r => { counts[r.campaign_id] = (counts[r.campaign_id] || 0) + 1; });
  ids.forEach(id => { campaigns[id]._member_count = counts[id] || 0; });
}

async function loadCampaignMembers(campaignId) {
  const { data, error } = await sb
    .from('campaign_members')
    .select('user_id')
    .eq('campaign_id', campaignId);
  if (error) { console.error('Erreur chargement membres:', error); campaignMembersMap[campaignId] = []; return; }

  const userIds = (data || []).map(r => r.user_id);
  let ownerMap = {};
  if (userIds.length) {
    const { data: profiles, error: profilesError } = await sb.from('profiles').select('id, username').in('id', userIds);
    if (profilesError) console.error('Erreur chargement profils membres:', profilesError);
    (profiles || []).forEach(p => { ownerMap[p.id] = p.username; });
  }
  campaignMembersMap[campaignId] = userIds
    .map(id => ({ user_id: id, username: ownerMap[id] || '?' }))
    .sort((a, b) => a.username.localeCompare(b.username));
}

async function loadUniverseMemberOptions() {
  const { data, error } = await sb
    .from('universe_members')
    .select('user_id')
    .eq('universe_id', currentUniverse.id);
  if (error) { console.error('Erreur chargement membres univers:', error); universeMemberOptions = []; return; }

  const userIds = (data || []).map(r => r.user_id).filter(id => id !== currentUniverse.owner_id);
  let ownerMap = {};
  if (userIds.length) {
    const { data: profiles, error: profilesError } = await sb.from('profiles').select('id, username').in('id', userIds);
    if (profilesError) console.error('Erreur chargement profils univers:', profilesError);
    (profiles || []).forEach(p => { ownerMap[p.id] = p.username; });
  }
  universeMemberOptions = userIds
    .map(id => ({ user_id: id, username: ownerMap[id] || '?' }))
    .sort((a, b) => a.username.localeCompare(b.username));
}

// Objets publics créés par un membre owner/gm de l'univers : ce sont les
// seuls éligibles à la sélection de visibilité par campagne. Les
// personnages publics des simples joueurs restent visibles à toute leur
// campagne sans sélection explicite (cf. shares_campaign_with côté RLS).
async function loadGMObjectOptions() {
  const empty = { character: [], chronicle: [], document: [], map: [] };
  const { data: gmMembers, error } = await sb
    .from('universe_members')
    .select('user_id')
    .eq('universe_id', currentUniverse.id)
    .in('role', ['owner', 'gm']);
  if (error) { console.error('Erreur chargement MJ univers:', error); gmObjectOptions = empty; return; }

  const gmIds = (gmMembers || []).map(r => r.user_id);
  if (!gmIds.length) { gmObjectOptions = empty; return; }

  const { data: profiles } = await sb.from('profiles').select('id, username').in('id', gmIds);
  const ownerMap = {};
  (profiles || []).forEach(p => { ownerMap[p.id] = p.username; });

  const [chars, chrs, docs, maps] = await Promise.all([
    sb.from('characters').select('id, name, user_id').eq('universe_id', currentUniverse.id).eq('is_public', true).in('user_id', gmIds),
    sb.from('chronicles').select('id, title, user_id').eq('universe_id', currentUniverse.id).eq('is_public', true).in('user_id', gmIds),
    sb.from('documents').select('id, title, user_id').eq('universe_id', currentUniverse.id).eq('is_public', true).in('user_id', gmIds),
    sb.from('map_layers').select('id, title, user_id').eq('universe_id', currentUniverse.id).eq('is_public', true).in('user_id', gmIds),
  ]);

  const toOptions = (result, labelField) => (result.data || [])
    .map(r => ({ id: r.id, label: r[labelField] || '?', owner: ownerMap[r.user_id] || '?' }))
    .sort((a, b) => a.label.localeCompare(b.label));

  gmObjectOptions = {
    character: toOptions(chars, 'name'),
    chronicle: toOptions(chrs, 'title'),
    document:  toOptions(docs, 'title'),
    map:       toOptions(maps, 'title'),
  };
}

async function loadCampaignVisibleObjects(campaignId) {
  const entries = await Promise.all(
    Object.entries(CAMPAIGN_OBJECT_TABLES).map(async ([type, { table, col }]) => {
      const { data } = await sb.from(table).select(col).eq('campaign_id', campaignId);
      return [type, new Set((data || []).map(r => r[col]))];
    })
  );
  return Object.fromEntries(entries);
}

// ══════════════════════════════════════════════════════════════
// CRUD — CAMPAGNES
// ══════════════════════════════════════════════════════════════

async function saveCampaignToDB() {
  if (!isUniverseOwner()) return;
  if (!campaignState.title.trim()) { alert(t('alert_campaign_no_title')); return; }

  const payload = {
    user_id:     currentUser.id,
    universe_id: currentUniverse.id,
    title:       campaignState.title.trim(),
    description: campaignState.description || '',
  };

  const isUUID = editingCampaignId &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(editingCampaignId);

  let result;
  if (isUUID) {
    result = await sb.from('campaigns').update(payload)
      .eq('id', editingCampaignId).eq('universe_id', currentUniverse.id).select('id').single();
  } else {
    editingCampaignId = null;
    result = await sb.from('campaigns').insert(payload).select('id').single();
  }
  if (result.error) { showToast(t('toast_campaign_save_error')); return; }

  editingCampaignId = result.data.id;
  campaigns[editingCampaignId] = { ...campaigns[editingCampaignId], ...payload, id: editingCampaignId };

  await saveCampaignMembersToDB(editingCampaignId);
  await saveCampaignObjectsToDB(editingCampaignId);
  await loadCampaignMemberCounts();
  showToast(t('toast_campaign_saved'));
}

async function saveCampaignObjectsToDB(campaignId) {
  for (const [type, { table, col }] of Object.entries(CAMPAIGN_OBJECT_TABLES)) {
    const { data: existing } = await sb.from(table).select(col).eq('campaign_id', campaignId);
    const existingSet = new Set((existing || []).map(r => r[col]));
    const selectedSet = campaignObjectSelection[type] || new Set();

    const toAdd    = [...selectedSet].filter(id => !existingSet.has(id));
    const toRemove = [...existingSet].filter(id => !selectedSet.has(id));

    if (toRemove.length) {
      await sb.from(table).delete().eq('campaign_id', campaignId).in(col, toRemove);
    }
    if (toAdd.length) {
      const rows = toAdd.map(id => ({ campaign_id: campaignId, [col]: id }));
      await sb.from(table).insert(rows);
    }
  }
}

async function saveCampaignMembersToDB(campaignId) {
  const { data: existing } = await sb
    .from('campaign_members')
    .select('user_id')
    .eq('campaign_id', campaignId);

  // Le propriétaire de l'univers est géré automatiquement (trigger DB) :
  // on ne diffe jamais sa ligne ici.
  const existingSet = new Set((existing || []).map(r => r.user_id).filter(id => id !== currentUniverse.owner_id));
  const selectedSet = campaignMemberSelection;

  const toAdd    = [...selectedSet].filter(id => !existingSet.has(id));
  const toRemove = [...existingSet].filter(id => !selectedSet.has(id));

  if (toRemove.length) {
    await sb.from('campaign_members').delete()
      .eq('campaign_id', campaignId)
      .in('user_id', toRemove);
  }
  if (toAdd.length) {
    const rows = toAdd.map(user_id => ({ campaign_id: campaignId, user_id }));
    await sb.from('campaign_members').insert(rows);
  }

  await loadCampaignMembers(campaignId);
}

async function deleteCampaignFromDB(id) {
  if (!isUniverseOwner()) return;
  const title = campaigns[id]?.title || 'cette campagne';
  if (!confirm(ti('confirm_delete_campaign', { title }))) return;
  const { error } = await sb.from('campaigns').delete().eq('id', id).eq('universe_id', currentUniverse.id);
  if (error) { showToast(t('toast_campaign_delete_error')); return; }
  delete campaigns[id];
  delete campaignMembersMap[id];
  renderCampaignsList();
  showView('campaigns');
}

// ══════════════════════════════════════════════════════════════
// RENDU — LISTE
// ══════════════════════════════════════════════════════════════

function renderCampaignsList() {
  const grid  = document.getElementById('campaign-grid');
  const empty = document.getElementById('campaign-empty-state');
  const newBtns = document.querySelectorAll('.campaign-new-btn');
  newBtns.forEach(b => { b.style.display = isUniverseOwner() ? '' : 'none'; });

  const keys = Object.keys(campaigns).sort((a, b) => (campaigns[a].title || '').localeCompare(campaigns[b].title || ''));

  document.getElementById('campaign-count-badge').textContent = keys.length ? `(${keys.length})` : '';

  if (!keys.length) { grid.innerHTML = ''; empty.style.display = 'flex'; return; }
  empty.style.display = 'none';

  grid.innerHTML = keys.map(id => campaignCardHTML(id, campaigns[id])).join('');
}

function campaignCardHTML(id, c) {
  const desc = c.description
    ? (c.description.length > 200 ? c.description.slice(0, 200) + '…' : c.description)
    : '';
  const memberCount = c._member_count || 0;
  const owner = isUniverseOwner();

  return `<div class="campaign-card" onclick="showCampaignDetail('${id}')">
    ${owner ? `<div class="campaign-card-actions">
      <button class="icon-btn" onclick="event.stopPropagation();openCampaignEditor('${id}')"
        title="${t('btn_edit')}">
        <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5">
          <path d="M11 2l3 3-9 9H2v-3z"/>
        </svg>
      </button>
      <button class="icon-btn danger" onclick="event.stopPropagation();deleteCampaignFromDB('${id}')"
        title="${t('btn_delete')}">
        <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5">
          <polyline points="3,4 13,4"/>
          <path d="M5 4V2h6v2M6 7v5M10 7v5"/>
          <path d="M4 4l1 10h6l1-10"/>
        </svg>
      </button>
    </div>` : ''}
    <div class="campaign-card-title">${esc(c.title) || 'Sans titre'}</div>
    ${desc ? `<div class="campaign-card-desc">${esc(desc)}</div>` : ''}
    <div class="campaign-card-footer">
      <span class="campaign-count-chip"><span class="n">${memberCount}</span> ${t('campaign_member_plural')}</span>
    </div>
  </div>`;
}

// ══════════════════════════════════════════════════════════════
// VUE DÉTAIL
// ══════════════════════════════════════════════════════════════

async function showCampaignDetail(campaignId) {
  activeCampaignId = campaignId;
  await loadCampaignMembers(campaignId);
  renderCampaignDetail();
  showView('campaign-detail');
}

function renderCampaignDetail() {
  const c = campaigns[activeCampaignId];
  if (!c) return;
  const owner = isUniverseOwner();
  const members = campaignMembersMap[activeCampaignId] || [];

  const memberRows = members.map(m => `
    <div class="campaign-item-row">
      <div class="campaign-member-avatar">${esc((m.username || '?').slice(0, 1).toUpperCase())}</div>
      <div class="campaign-item-row-name">${esc(m.username)}${m.user_id === currentUniverse.owner_id ? ` <span class="campaign-owner-label">${t('campaign_owner_tag')}</span>` : ''}</div>
    </div>`).join('');

  const noMembers = !members.length
    ? `<div style="color:var(--text3);font-size:13px;font-style:italic;padding:20px 0">${t('campaign_no_members')}</div>` : '';

  document.getElementById('campaign-detail-content').innerHTML = `
    <div class="campaign-detail-inner">
      <div class="campaign-detail-header">
        <div>
          <div class="campaign-detail-title">${esc(c.title)}</div>
          ${c.description ? `<div class="campaign-detail-desc">${esc(c.description)}</div>` : ''}
        </div>
        ${owner ? `<div class="campaign-detail-actions">
          <button class="btn-cancel" onclick="openCampaignEditor('${activeCampaignId}')">
            <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" width="13" height="13">
              <path d="M11 2l3 3-9 9H2v-3z"/>
            </svg>
            ${t('btn_edit')}
          </button>
        </div>` : ''}
      </div>
      <div class="campaign-section">
        <div class="campaign-section-title">
          ${t('campaign_member_plural')}
          <span class="campaign-section-count">(${members.length})</span>
        </div>
        ${noMembers}
        ${memberRows}
      </div>
    </div>`;
}

// ══════════════════════════════════════════════════════════════
// ÉDITEUR CAMPAGNE — formulaire + sélection des membres
// ══════════════════════════════════════════════════════════════

function newCampaign() {
  if (!isUniverseOwner()) return;
  editingCampaignId = null;
  campaignState = { title: '', description: '' };
  campaignMemberSelection = new Set();
  // Nouvelle campagne : aucun objet MJ coché par défaut (opt-in).
  campaignObjectSelection = { character: new Set(), chronicle: new Set(), document: new Set(), map: new Set() };
  showView('campaign-editor');
  renderCampaignEditor();
}

async function openCampaignEditor(id) {
  if (!isUniverseOwner()) return;
  editingCampaignId = id;
  campaignState = { ...campaigns[id] };
  await loadCampaignMembers(id);
  campaignMemberSelection = new Set(
    (campaignMembersMap[id] || [])
      .map(m => m.user_id)
      .filter(uid => uid !== currentUniverse.owner_id)
  );
  campaignObjectSelection = await loadCampaignVisibleObjects(id);
  showView('campaign-editor');
  renderCampaignEditor();
}

async function renderCampaignEditor() {
  document.getElementById('campaign-f-title').value       = campaignState.title || '';
  document.getElementById('campaign-f-description').value = campaignState.description || '';
  if (!universeMemberOptions.length) await loadUniverseMemberOptions();
  await loadGMObjectOptions();
  renderMemberPicker();
  renderObjectPicker();
  renderSelectionSummary();
}

function updateCampaignForm() {
  campaignState.title       = document.getElementById('campaign-f-title').value;
  campaignState.description = document.getElementById('campaign-f-description').value;
}

// ── Sélection des membres ───────────────────────────────────────

function renderMemberPicker() {
  const container = document.getElementById('campaign-member-picker');
  if (!container) return;
  if (!universeMemberOptions.length) {
    container.innerHTML = `<div style="color:var(--text3);font-size:12px;font-style:italic;padding:6px 0">${t('campaign_no_other_members')}</div>`;
    return;
  }
  const grid = universeMemberOptions.map(m => {
    const sel = campaignMemberSelection.has(m.user_id);
    return `<div class="campaign-selectable-item ${sel ? 'selected' : ''}"
      onclick="toggleCampaignMember('${m.user_id}', this)">
      <div class="campaign-selectable-check"></div>
      <div style="flex:1;overflow:hidden;min-width:0">
        <div class="campaign-selectable-name">${esc(m.username)}</div>
      </div>
    </div>`;
  }).join('');
  container.innerHTML = `<div class="campaign-selectable-grid">${grid}</div>`;
}

function toggleCampaignMember(userId, el) {
  if (campaignMemberSelection.has(userId)) {
    campaignMemberSelection.delete(userId);
    el.classList.remove('selected');
  } else {
    campaignMemberSelection.add(userId);
    el.classList.add('selected');
  }
  renderSelectionSummary();
}

function renderSelectionSummary() {
  const summaryEl = document.getElementById('campaign-selection-summary');
  if (!summaryEl) return;
  const n = campaignMemberSelection.size;
  summaryEl.querySelector('.summary-text').textContent = n
    ? ti('campaign_selection_members_count', { n })
    : t('campaign_selection_no_members');
}

// ── Sélection des objets MJ ─────────────────────────────────────

const CAMPAIGN_OBJECT_TYPE_LABEL_KEYS = {
  character: 'campaign_objects_type_character',
  chronicle: 'campaign_objects_type_chronicle',
  document:  'campaign_objects_type_document',
  map:       'campaign_objects_type_map',
};

function renderObjectPicker() {
  const container = document.getElementById('campaign-object-picker');
  if (!container) return;
  const types = Object.keys(CAMPAIGN_OBJECT_TYPE_LABEL_KEYS).filter(type => gmObjectOptions[type]?.length);

  if (!types.length) {
    container.innerHTML = `<div style="color:var(--text3);font-size:12px;font-style:italic;padding:6px 0">${t('campaign_no_gm_objects')}</div>`;
    return;
  }

  container.innerHTML = types.map(type => {
    const items = gmObjectOptions[type].map(o => {
      const sel = campaignObjectSelection[type]?.has(o.id);
      return `<div class="campaign-selectable-item ${sel ? 'selected' : ''}"
        onclick="toggleCampaignObject('${type}', '${o.id}', this)">
        <div class="campaign-selectable-check"></div>
        <div style="flex:1;overflow:hidden;min-width:0">
          <div class="campaign-selectable-name">${esc(o.label)}</div>
          <div class="campaign-selectable-sub">${esc(o.owner)}</div>
        </div>
      </div>`;
    }).join('');
    return `<div class="campaign-object-type-group">
      <div class="campaign-object-type-label">${t(CAMPAIGN_OBJECT_TYPE_LABEL_KEYS[type])}</div>
      <div class="campaign-selectable-grid">${items}</div>
    </div>`;
  }).join('');
}

function toggleCampaignObject(type, id, el) {
  const set = campaignObjectSelection[type];
  if (!set) return;
  if (set.has(id)) {
    set.delete(id);
    el.classList.remove('selected');
  } else {
    set.add(id);
    el.classList.add('selected');
  }
}
