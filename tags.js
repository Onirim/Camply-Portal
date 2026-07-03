// ══════════════════════════════════════════════════════════════
// Camply TTRPG Manager — Module Tags
// ══════════════════════════════════════════════════════════════

// ── Couleurs prédéfinies ──────────────────────────────────────
const TAG_COLORS = [
  '#e05c5c', '#e07a3a', '#e8c46a', '#5cbf7a',
  '#5c9be0', '#9b7de8', '#e05c9b', '#5cbfbf',
];

function randomTagColor() {
  return TAG_COLORS[Math.floor(Math.random() * TAG_COLORS.length)];
}

// ══════════════════════════════════════════════════════════════
// TAGS — Filtre roster
// ══════════════════════════════════════════════════════════════

function renderRosterFilters() {
  const bar      = document.getElementById('roster-filters');
  const list     = document.getElementById('filter-tags-list');
  const clearBtn = document.getElementById('filter-clear-btn');
  const hasFollowed = Object.keys(followedChars).length > 0;
  const hasFilters  = allTags.length || hasFollowed;
  if (!hasFilters) { bar.style.display = 'none'; return; }
  bar.style.display = 'flex';
  const followedBtn = hasFollowed ? `
    <button class="filter-tag ${filterFollowed ? 'active' : ''}"
      style="background:rgba(155,125,232,0.12);color:var(--sup)"
      onclick="toggleFollowedFilter()">${t('roster_filter_followed')}</button>` : '';
  list.innerHTML = followedBtn + allTags.map(tg => {
    const active = activeTagFilters.includes(tg.id);
    return `<button class="filter-tag ${active ? 'active' : ''}"
      style="background:${tg.color}18;color:${tg.color}"
      onclick="toggleTagFilter('${tg.id}')">${esc(tg.name)}</button>`;
  }).join('');
  clearBtn.style.display = (activeTagFilters.length || filterFollowed) ? 'inline-block' : 'none';
}

function toggleFollowedFilter() {
  filterFollowed = !filterFollowed;
  renderRosterFilters();
  renderList();
}

function toggleTagFilter(tagId) {
  const idx = activeTagFilters.indexOf(tagId);
  if (idx >= 0) activeTagFilters.splice(idx, 1);
  else activeTagFilters.push(tagId);
  renderRosterFilters();
  renderList();
}

function clearTagFilters() {
  activeTagFilters = [];
  filterFollowed = false;
  renderRosterFilters();
  renderList();
}

// ══════════════════════════════════════════════════════════════
// TAGS — Modale de gestion (carte personnage, au survol)
// Gère indifféremment mes personnages et ceux des autres membres :
// un tag est une organisation personnelle, pas liée à la propriété
// de l'objet tagué.
// ══════════════════════════════════════════════════════════════

let editingTagCharId = null;

function editCharTags(charId) {
  editingTagCharId = charId;
  const c = chars[charId] || followedChars[charId];
  const tags = (charTagMap[charId] || [])
    .map(tid => allTags.find(x => x.id === tid)).filter(Boolean);
  renderCharTagChips(charId, tags);
  document.getElementById('char-tag-modal-name').textContent = c?.name || '';
  document.getElementById('char-tag-modal').style.display = 'flex';
  document.getElementById('char-tag-input').value = '';
  document.getElementById('char-tag-autocomplete').style.display = 'none';
}

function closeCharTagModal() {
  document.getElementById('char-tag-modal').style.display = 'none';
  editingTagCharId = null;
}

function renderCharTagChips(charId, tags) {
  const container = document.getElementById('char-tag-chips');
  const list = tags || (charTagMap[charId] || [])
    .map(tid => allTags.find(x => x.id === tid)).filter(Boolean);
  container.innerHTML = list.map(tg => `
    <span class="tag-chip" style="background:${tg.color}22;color:${tg.color};border:1px solid ${tg.color}44">
      ${esc(tg.name)}
      <button class="tag-remove" onclick="removeCharTag('${charId}','${tg.id}')" tabindex="-1">×</button>
    </span>`).join('');
}

async function removeCharTag(charId, tagId) {
  // 1. Retire la liaison
  charTagMap[charId] = (charTagMap[charId] || []).filter(id => id !== tagId);
  await sb.from('character_tags')
    .delete()
    .eq('user_id', currentUser.id)
    .eq('character_id', charId)
    .eq('tag_id', tagId)
    .eq('universe_id', currentUniverse.id);

  // 2. Purge côté serveur les tags devenus orphelins
  await cleanupOrphanTags('char');

  // 3. Recharge pour que allTags soit à jour
  await loadTagsFromDB();

  renderCharTagChips(charId);
  renderList();
}

async function addCharTag(name) {
  name = name.trim();
  if (!name || !editingTagCharId) return;
  let tg = allTags.find(x => x.name.toLowerCase() === name.toLowerCase());
  if (!tg) {
    const color = randomTagColor();
    const { data, error } = await sb.from('tags')
      .insert({ user_id: currentUser.id, universe_id: currentUniverse.id, name, color })
      .select().single();
    if (error) { showToast(t('toast_tag_error')); return; }
    tg = data;
    allTags.push(tg);
    allTags.sort((a, b) => a.name.localeCompare(b.name));
  }
  const charId = editingTagCharId;
  if (!(charTagMap[charId] || []).includes(tg.id)) {
    if (!charTagMap[charId]) charTagMap[charId] = [];
    charTagMap[charId].push(tg.id);
    await sb.from('character_tags')
      .insert({ user_id: currentUser.id, character_id: charId, tag_id: tg.id, universe_id: currentUniverse.id });
    renderCharTagChips(charId);
    renderRosterFilters();
    renderList();
  }
  document.getElementById('char-tag-input').value = '';
  document.getElementById('char-tag-autocomplete').style.display = 'none';
}

function onCharTagInput(val) {
  const ac = document.getElementById('char-tag-autocomplete');
  const q = val.trim().toLowerCase();
  const assigned = charTagMap[editingTagCharId] || [];
  const filtered = allTags.filter(tg => !assigned.includes(tg.id) && (!q || tg.name.toLowerCase().includes(q)));
  const exactMatch = allTags.find(tg => tg.name.toLowerCase() === q);
  const showCreate = q && !exactMatch;
  if (!filtered.length && !showCreate) { ac.style.display = 'none'; return; }
  ac.innerHTML = [
    ...filtered.map(tg => `
      <div class="tags-autocomplete-item" onclick="selectCharTag('${tg.id}')">
        <span class="dot" style="background:${tg.color}"></span>${esc(tg.name)}
      </div>`),
    showCreate ? `
      <div class="tags-autocomplete-item" onclick="addCharTag('${esc(val.trim())}')">
        <span class="dot" style="background:${randomTagColor()}"></span>${esc(val.trim())}
        <span class="new-hint">${t('editor_tag_create_hint')}</span>
      </div>` : ''
  ].join('');
  ac.style.display = 'block';
}

async function selectCharTag(tagId) {
  const tg = allTags.find(x => x.id === tagId);
  if (!tg || !editingTagCharId) return;
  const charId = editingTagCharId;
  if (!(charTagMap[charId] || []).includes(tg.id)) {
    if (!charTagMap[charId]) charTagMap[charId] = [];
    charTagMap[charId].push(tg.id);
    const { error } = await sb.from('character_tags')
      .insert({ user_id: currentUser.id, character_id: charId, tag_id: tg.id, universe_id: currentUniverse.id });
    if (error) {
      charTagMap[charId] = charTagMap[charId].filter(id => id !== tg.id);
      showToast(t('toast_tag_add_error'));
      return;
    }
    renderCharTagChips(charId);
    renderRosterFilters();
    renderList();
  }
  document.getElementById('char-tag-input').value = '';
  document.getElementById('char-tag-autocomplete').style.display = 'none';
}

function onCharTagKeydown(e) {
  if (e.key === 'Enter' || e.key === ',') {
    e.preventDefault();
    const ac = document.getElementById('char-tag-autocomplete');
    const active = ac.querySelector('.tags-autocomplete-item.active');
    if (active) active.click();
    else { const v = e.target.value.trim(); if (v) addCharTag(v); }
  } else if (e.key === 'Escape') {
    document.getElementById('char-tag-autocomplete').style.display = 'none';
  }
}
