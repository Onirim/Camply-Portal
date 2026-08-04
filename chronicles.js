// ══════════════════════════════════════════════════════════════
// Camply TTRPG Manager — Module Chroniques v2
// ══════════════════════════════════════════════════════════════

// ── État ──────────────────────────────────────────────────────
let chronicles         = {};
let followedChronicles = {};
let chrEntries         = {};

let activeChrId          = null;
let editingChrId         = null;
let editingChrIsFollowed = false;
let editingEntryId       = null;
let chrState             = null;
let entryState           = null;

const HEART_SVG = '<svg viewBox="0 0 16 16" fill="currentColor"><path d="M8 13.6s-5.4-3.2-5.4-6.98A2.98 2.98 0 0 1 8 4.85a2.98 2.98 0 0 1 5.4 1.77c0 3.78-5.4 6.98-5.4 6.98z"/></svg>';

function chrLikeBadgeHTML(count) {
  const n = count || 0;
  return `<span class="chr-card-likes${n === 0 ? ' zero' : ''}">${n}${HEART_SVG}</span>`;
}

// ══════════════════════════════════════════════════════════════
// CHARGEMENT
// ══════════════════════════════════════════════════════════════

async function loadChroniclesFromDB() {
  const { data, error } = await sb
    .from('chronicles')
    .select('id, title, description, is_public, user_id, illustration_url, illustration_position, updated_at')
    .eq('universe_id', currentUniverse.id)
    .order('updated_at', { ascending: false });
  if (error) { console.error('Erreur chargement chroniques:', error); return; }

  const ids = (data || []).map(r => r.id);
  let countMap = {};
  let entryIdsByChronicle = {};
  let likeCountByChronicle = {};
  if (ids.length) {
    const { data: entries } = await sb
      .from('chronicle_entries')
      .select('id, chronicle_id')
      .in('chronicle_id', ids);
    (entries || []).forEach(e => {
      countMap[e.chronicle_id] = (countMap[e.chronicle_id] || 0) + 1;
      if (!entryIdsByChronicle[e.chronicle_id]) entryIdsByChronicle[e.chronicle_id] = [];
      entryIdsByChronicle[e.chronicle_id].push(e.id);
    });

    const allEntryIds = (entries || []).map(e => e.id);
    if (allEntryIds.length) {
      const { data: likes } = await sb
        .from('chronicle_entry_likes')
        .select('entry_id')
        .in('entry_id', allEntryIds);
      const entryToChronicle = {};
      (entries || []).forEach(e => { entryToChronicle[e.id] = e.chronicle_id; });
      (likes || []).forEach(l => {
        const chrId = entryToChronicle[l.entry_id];
        if (chrId) likeCountByChronicle[chrId] = (likeCountByChronicle[chrId] || 0) + 1;
      });
    }
  }

  const ownerIds = [...new Set((data || []).filter(r => r.user_id !== currentUser.id).map(r => r.user_id))];
  let ownerMap = {};
  if (ownerIds.length) {
    const { data: profiles } = await sb.from('profiles').select('id, username').in('id', ownerIds);
    (profiles || []).forEach(p => { ownerMap[p.id] = p.username; });
  }

  chronicles = {};
  followedChronicles = {};
  (data || []).forEach(r => {
    const entry = { ...r, entry_count: countMap[r.id] || 0, like_count: likeCountByChronicle[r.id] || 0 };
    if (r.user_id === currentUser.id) {
      chronicles[r.id] = entry;
    } else {
      followedChronicles[r.id] = { ...entry, _followed: true, _owner_name: ownerMap[r.user_id] || '?' };
      unreadMarkers.syncChronicleEntries(r.id, entryIdsByChronicle[r.id] || []);
      if (!chrEntries[r.id]) chrEntries[r.id] = (entryIdsByChronicle[r.id] || []).map(id => ({ id }));
    }
  });
}

async function loadEntriesForChronicle(chrId) {
  const { data, error } = await sb
    .from('chronicle_entries')
    .select('id, title, content, created_at, updated_at')
    .eq('chronicle_id', chrId)
    .order('created_at', { ascending: false });
  if (error) { console.error('Erreur chargement entrées:', error); return; }
  chrEntries[chrId] = data || [];

  const entryIds = chrEntries[chrId].map(e => e.id);
  if (entryIds.length) {
    const { data: likes } = await sb
      .from('chronicle_entry_likes')
      .select('entry_id, user_id')
      .in('entry_id', entryIds);
    const likeCountByEntry = {};
    const likedByMeSet = new Set();
    (likes || []).forEach(l => {
      likeCountByEntry[l.entry_id] = (likeCountByEntry[l.entry_id] || 0) + 1;
      if (l.user_id === currentUser.id) likedByMeSet.add(l.entry_id);
    });
    chrEntries[chrId].forEach(e => {
      e.like_count   = likeCountByEntry[e.id] || 0;
      e.liked_by_me  = likedByMeSet.has(e.id);
    });
  }

  unreadMarkers.syncChronicleEntries(chrId, chrEntries[chrId].map(e => e.id));
}

// ══════════════════════════════════════════════════════════════
// CRUD — CHRONIQUES
// ══════════════════════════════════════════════════════════════

async function saveChronicleToDB() {
  if (!chrState.title.trim()) { showToast(t('alert_chr_no_title')); return; }
  const isUUID = editingChrId &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(editingChrId);

  let targetId = isUUID ? editingChrId : null;
  if (chrIllusStaging) {
    if (!targetId) targetId = crypto.randomUUID();
    const { url, error: promoteError } = await promoteStagedIllustration(
      'character-illustrations', chrIllusStaging, `${currentUser.id}/chr_${targetId}.jpg`, chrState.illustration_url
    );
    chrState.illustration_url = url;
    chrIllusStaging = null;
    if (promoteError) showToast(t('toast_illus_upload_error') + promoteError.message);
  }

  const payload = {
    title:                 chrState.title.trim(),
    description:           chrState.description,
    illustration_url:      chrState.illustration_url || '',
    illustration_position: chrState.illustration_position || 0,
  };
  if (!editingChrIsFollowed) {
    payload.user_id     = currentUser.id;
    payload.universe_id = currentUniverse.id;
    payload.is_public   = chrState.is_public || false;
    if (targetId && !isUUID) payload.id = targetId;
  }

  let result;
  if (isUUID) {
    result = await sb.from('chronicles').update(payload)
      .eq('id', editingChrId).eq('universe_id', currentUniverse.id).select('id').single();
  } else {
    editingChrId = null;
    result = await sb.from('chronicles').insert(payload)
      .select('id').single();
  }
  if (result.error) { showToast(t('toast_chr_save_error')); return; }

  editingChrId = result.data.id;
  if (editingChrIsFollowed) {
    followedChronicles[editingChrId] = { ...followedChronicles[editingChrId], ...chrState, id: editingChrId };
  } else {
    chronicles[editingChrId] = { ...chrState, id: editingChrId };
  }
  showToast(t('toast_chr_saved'));
}

async function deleteChronicleFromDB(id) {
  const src = chronicles[id] || followedChronicles[id];
  const title = src?.title || 'cette chronique';
  if (!confirm(ti('confirm_delete_chr', { title }))) return;

  const illustrationUrl = src?.illustration_url || '';

  const { error } = await sb.from('chronicles').delete().eq('id', id).eq('universe_id', currentUniverse.id);
  if (error) { showToast(t('toast_chr_delete_error')); return; }
  delete chronicles[id];
  delete followedChronicles[id];
  delete chrEntries[id];

  if (illustrationUrl) await deleteStorageFile(illustrationUrl);

  renderChroniclesList();
  showView('chronicles');
}

// ══════════════════════════════════════════════════════════════
// CRUD — ENTRÉES
// ══════════════════════════════════════════════════════════════

async function saveEntryToDB() {
  if (!entryState.title.trim()) { showToast(t('alert_entry_no_title')); return; }
  const payload = {
    chronicle_id: activeChrId,
    title:        entryState.title.trim(),
    content:      entryState.content,
  };
  const isUUID = editingEntryId &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(editingEntryId);

  let result;
  if (isUUID) {
    result = await sb.from('chronicle_entries').update(payload)
      .eq('id', editingEntryId).select('id').single();
  } else {
    editingEntryId = null;
    result = await sb.from('chronicle_entries').insert(payload)
      .select('id').single();
  }
  if (result.error) { showToast(t('toast_entry_save_error')); return; }

  const isNewEntry = !isUUID;
  editingEntryId = result.data.id;
  await loadEntriesForChronicle(activeChrId);

  if (isNewEntry && chronicles[activeChrId]) {
    chronicles[activeChrId].entry_count = (chronicles[activeChrId].entry_count || 0) + 1;
    chronicles[activeChrId].updated_at = new Date().toISOString();
  }

  showToast(t('toast_entry_saved'));
  showChrDetail(activeChrId);
}

async function deleteEntryFromDB(entryId) {
  const entry = (chrEntries[activeChrId] || []).find(e => e.id === entryId);
  if (!confirm(ti('confirm_delete_entry', { title: entry?.title || 'cette entrée' }))) return;
  const { error } = await sb.from('chronicle_entries').delete().eq('id', entryId);
  if (error) { showToast(t('toast_entry_delete_error')); return; }
  await loadEntriesForChronicle(activeChrId);

  if (chronicles[activeChrId]) {
    chronicles[activeChrId].entry_count = Math.max(0, (chronicles[activeChrId].entry_count || 1) - 1);
    chronicles[activeChrId].like_count  = Math.max(0, (chronicles[activeChrId].like_count || 0) - (entry?.like_count || 0));
  }

  renderChrDetail();
}

// ══════════════════════════════════════════════════════════════
// RENDU — LISTE DES CHRONIQUES
// ══════════════════════════════════════════════════════════════

function renderChroniclesList() {
  const grid  = document.getElementById('chr-grid');
  const empty = document.getElementById('chr-empty-state');
  const ownKeys      = Object.keys(chronicles).sort((a,b) => (chronicles[a].title||'').localeCompare(chronicles[b].title||''));
  const followedKeys = Object.keys(followedChronicles).sort((a,b) => (followedChronicles[a].title||'').localeCompare(followedChronicles[b].title||''));
  const total = ownKeys.length + followedKeys.length;

  document.getElementById('chr-count-badge').textContent = total ? `(${total})` : '';

  unreadMarkers.refreshNavBadges({ followedChars, followedDocuments, followedChronicles, chrEntries });
  if (!total) { grid.innerHTML = ''; empty.style.display = 'flex'; return; }
  empty.style.display = 'none';
  grid.innerHTML = [
    ...ownKeys.map(id    => chrCardHTML(id, chronicles[id], false)),
    ...followedKeys.map(id => chrCardHTML(id, followedChronicles[id], true)),
  ].join('');
}

function chrEntryCountLabel(n) {
  if (n === 0) return t('chr_entry_count_zero');
  if (n === 1) return t('chr_entry_count_one');
  return ti('chr_entry_count_many', { n });
}

function chrCardHTML(id, c, isFollowed) {
  const desc = c.description
    ? (c.description.length > 220 ? c.description.slice(0, 220) + '…' : c.description)
    : '';
  const lastDate = c.updated_at
    ? new Date(c.updated_at).toLocaleDateString(currentLang === 'en' ? 'en-GB' : 'fr-FR', { day:'numeric', month:'short', year:'numeric' })
    : '';
  const entryCount = c.entry_count ?? 0;
  const entryLabel = chrEntryCountLabel(entryCount);

  const metaHtml = `
    <div class="chr-card-meta">
      <span class="chr-card-entry-count">${entryLabel}</span>
      ${lastDate ? `<span class="chr-card-last-date">${t('chr_last_update')}${lastDate}</span>` : ''}
    </div>`;

  const likesTag = chrLikeBadgeHTML(c.like_count);

  if (isFollowed) {
    const entryIds = (chrEntries[id] || []).map(e => e.id);
    const hasUnreadEntry = unreadMarkers.chronicleHasUnreadEntries(id, entryIds, false);
    const showUnread = unreadMarkers.isChronicleUnread(id, false) || hasUnreadEntry;
    return `<div class="chr-card" onclick="showChrDetail('${id}')">${unreadMarkers.cardDotHTML(showUnread)}
      ${c.illustration_url ? `<img class="card-illus" src="${esc(c.illustration_url)}" style="object-position:center ${c.illustration_position||0}%" onclick="event.stopPropagation();openLightbox('${esc(c.illustration_url)}')" alt="">` : ''}
      <div class="chr-card-title">${esc(c.title) || 'Sans titre'}</div>
      <div class="chr-card-desc">${esc(desc)}</div>
      ${metaHtml}
      <div class="chr-card-footer">
        <span class="followed-badge">${t('followed_badge')}</span>
        ${likesTag}
        <span class="chr-card-owner">${t('chr_followed_owner')}${esc(c._owner_name)}</span>
      </div>
    </div>`;
  }

  const visTag = c.is_public
    ? `<span class="card-visibility public">${t('visibility_public_chr')}</span>`
    : `<span class="card-visibility private">${t('visibility_private_chr')}</span>`;

  return `<div class="chr-card" onclick="showChrDetail('${id}')">
    ${c.illustration_url ? `<img class="card-illus" src="${esc(c.illustration_url)}" style="object-position:center ${c.illustration_position||0}%" onclick="event.stopPropagation();openLightbox('${esc(c.illustration_url)}')" alt="">` : ''}
    <div class="chr-card-actions">
      <button class="icon-btn" onclick="event.stopPropagation();openChrEditor('${id}')" title="${t('btn_edit')}">
        <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M11 2l3 3-9 9H2v-3z"/></svg>
      </button>
      <button class="icon-btn danger" onclick="event.stopPropagation();deleteChronicleFromDB('${id}')" title="${t('btn_delete')}">
        <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5"><polyline points="3,4 13,4"/><path d="M5 4V2h6v2M6 7v5M10 7v5"/><path d="M4 4l1 10h6l1-10"/></svg>
      </button>
    </div>
    <div class="chr-card-title">${esc(c.title) || 'Sans titre'}</div>
    <div class="chr-card-desc">${esc(desc)}</div>
    ${metaHtml}
    <div class="chr-card-footer">
      ${visTag}
      ${likesTag}
    </div>
  </div>`;
}

// ══════════════════════════════════════════════════════════════
// VUE DÉTAIL — liste des entrées
// ══════════════════════════════════════════════════════════════

async function showChrDetail(chrId) {
  activeChrId = chrId;
  await loadEntriesForChronicle(chrId);
  renderChrDetail();
  showView('chr-detail');
  if (!chronicles[chrId]) unreadMarkers.markChronicleRead(chrId);
  unreadMarkers.refreshNavBadges({ followedChars, followedDocuments, followedChronicles, chrEntries });
  setHash('chr', chrId);
}

function shareChrDetailBtn() {
  if (!activeChrId) return;
  const chr = chronicles[activeChrId] || followedChronicles[activeChrId];
  if (!chr?.is_public) { showToast(t('toast_chr_share_need_public')); return; }
  copyUrl(buildShareUrl('chr', activeChrId));
}

function renderChrDetail() {
  const chr = chronicles[activeChrId] || followedChronicles[activeChrId];
  if (!chr) return;
  const isOwn   = !!chronicles[activeChrId];
  const canEdit = isOwn || isUniverseGM();
  const entries = chrEntries[activeChrId] || [];

  const visTag = chr.is_public
    ? `<span class="card-visibility public">${t('visibility_public_chr')}</span>`
    : `<span class="card-visibility private">${t('visibility_private_chr')}</span>`;
  const ownerTag = chr._owner_name
    ? `<span class="chr-detail-owner">${t('chr_followed_owner')}${esc(chr._owner_name)}</span>` : '';
  const likesTag = `<span id="chr-detail-like-badge">${chrLikeBadgeHTML(chr.like_count)}</span>`;

  const entriesHtml = entries.length
    ? entries.map(e => entryRowHTML(e, isOwn, activeChrId, canEdit)).join('')
    : `<div class="chr-no-entries">${t('chr_no_entries')}</div>`;

  document.getElementById('chr-detail-content').innerHTML = `
    <div class="chr-detail-inner">
      ${chr.illustration_url ? `<img class="chr-detail-illus" src="${esc(chr.illustration_url)}" style="object-position:center ${chr.illustration_position||0}%" onclick="openLightbox('${esc(chr.illustration_url)}')" alt="">` : ''}
      <div class="chr-detail-header">
      <div>
        <div class="chr-detail-title">${esc(chr.title)}</div>
        ${chr.description ? `<div class="chr-detail-desc">${esc(chr.description)}</div>` : ''}
        <div class="chr-detail-meta">${visTag}${likesTag}${ownerTag}</div>
      </div>
      ${canEdit ? `<div class="chr-detail-actions">
        <button class="btn-cancel" onclick="openChrEditor('${activeChrId}')">
          <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" width="13" height="13"><path d="M11 2l3 3-9 9H2v-3z"/></svg>
          ${t('chr_detail_btn_edit')}
        </button>
        <button class="btn-primary" onclick="newEntry()">
          <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2" width="13" height="13"><line x1="8" y1="2" x2="8" y2="14"/><line x1="2" y1="8" x2="14" y2="8"/></svg>
          ${t('chr_detail_btn_new_entry')}
        </button>
        ${!isOwn ? `<button class="icon-btn danger" onclick="deleteChronicleFromDB('${activeChrId}')" title="${t('btn_delete')}">
          <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5"><polyline points="3,4 13,4"/><path d="M5 4V2h6v2M6 7v5M10 7v5"/><path d="M4 4l1 10h6l1-10"/></svg>
        </button>` : ''}
      </div>` : ''}
    </div>
    <div class="chr-entries-list">${entriesHtml}</div>
    </div>
  `;
}

function entryRowHTML(e, isOwn, chrId, canEdit = isOwn) {
  const date = e.created_at
    ? new Date(e.created_at).toLocaleDateString(currentLang === 'en' ? 'en-GB' : 'fr-FR', { day:'numeric', month:'long', year:'numeric' })
    : '';
  const preview = markdownPreview(e.content, 160);

  const unreadDot = unreadMarkers.entryDotHTML(unreadMarkers.isEntryUnread(chrId, e.id, isOwn));
  return `<div class="entry-row" onclick="openEntryReader('${e.id}')">${unreadDot}
    <div class="entry-row-header">
      <div class="entry-row-title">${esc(e.title)}</div>
      ${chrLikeBadgeHTML(e.like_count)}
      <div class="entry-row-date">${date}</div>
      ${canEdit ? `<div class="entry-row-actions" onclick="event.stopPropagation()">
        <button class="icon-btn" onclick="openEntryEditor('${e.id}')" title="${t('btn_edit')}">
          <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M11 2l3 3-9 9H2v-3z"/></svg>
        </button>
        ${canEdit ? `<button class="icon-btn danger" onclick="deleteEntryFromDB('${e.id}')" title="${t('btn_delete')}">
          <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5"><polyline points="3,4 13,4"/><path d="M5 4V2h6v2M6 7v5M10 7v5"/><path d="M4 4l1 10h6l1-10"/></svg>
        </button>` : ''}
      </div>` : ''}
    </div>
    ${preview ? `<div class="entry-row-preview">${esc(preview)}</div>` : ''}
  </div>`;
}

// ══════════════════════════════════════════════════════════════
// FORMULAIRE — CHRONIQUE
// ══════════════════════════════════════════════════════════════

let chrIllusStaging = null; // chemin de staging en attente de sauvegarde, ou null

function newChronicle() {
  if (chrIllusStaging) { discardStagedIllustration('character-illustrations', chrIllusStaging); chrIllusStaging = null; }
  editingChrId = null;
  editingChrIsFollowed = false;
  chrState = { title: '', description: '', is_public: false,
               illustration_url: '', illustration_position: 0 };
  showView('chr-editor');
  populateChrEditor();
}

function openChrEditor(id) {
  if (chrIllusStaging) { discardStagedIllustration('character-illustrations', chrIllusStaging); chrIllusStaging = null; }
  editingChrId = id;
  editingChrIsFollowed = !!followedChronicles[id] && !chronicles[id];
  chrState = { ...(chronicles[id] || followedChronicles[id]) };
  showView('chr-editor');
  populateChrEditor();
}

function populateChrEditor() {
  document.getElementById('chr-f-title').value       = chrState.title || '';
  document.getElementById('chr-f-description').value = chrState.description || '';
  const pub = document.getElementById('chr-f-public');
  pub.checked  = chrState.is_public || false;
  pub.disabled = editingChrIsFollowed;
  document.getElementById('chr-public-label').textContent =
    pub.checked ? t('share_code_active_chr') : t('share_code_inactive_chr');
  setChrIllusPreview(chrState.illustration_url || '', chrState.illustration_position || 0);
}

function updateChrForm() {
  chrState.title       = document.getElementById('chr-f-title').value;
  chrState.description = document.getElementById('chr-f-description').value;
  chrState.is_public   = document.getElementById('chr-f-public').checked;
  document.getElementById('chr-public-label').textContent =
    chrState.is_public ? t('share_code_active_chr') : t('share_code_inactive_chr');
}

// ══════════════════════════════════════════════════════════════
// FORMULAIRE — ENTRÉE
// ══════════════════════════════════════════════════════════════

function newEntry() {
  editingEntryId = null;
  entryState = { title: '', content: '' };
  populateEntryEditor();
  showView('entry-editor');
}

function openEntryEditor(entryId) {
  editingEntryId = entryId;
  const entry = (chrEntries[activeChrId] || []).find(e => e.id === entryId);
  entryState = entry ? { ...entry } : { title: '', content: '' };
  populateEntryEditor();
  showView('entry-editor');
}

function populateEntryEditor() {
  document.getElementById('entry-f-title').value   = entryState.title || '';
  document.getElementById('entry-f-content').value = entryState.content || '';
  updateEntryPreview();
}

function updateEntryPreview() {
  entryState.title   = document.getElementById('entry-f-title').value;
  const contentEl = document.getElementById('entry-f-content');
  entryState.content = normalizeMarkdownTextarea(contentEl);
  const preview = document.getElementById('entry-preview-content');
  const titleHtml = entryState.title
    ? `<h1 class="chr-reader-title">${esc(entryState.title)}</h1>` : '';
  const bodyHtml = entryState.content
    ? renderMarkdown(entryState.content)
    : `<p class="chr-empty-preview">${t('entry_preview_empty')}</p>`;
  preview.innerHTML = titleHtml + `<div class="chr-reader-body">${bodyHtml}</div>`;
}

function switchEntryTab(tab) {
  const form    = document.getElementById('entry-editor-form');
  const preview = document.getElementById('entry-preview-panel');
  const btnF    = document.getElementById('entry-mob-tab-form');
  const btnP    = document.getElementById('entry-mob-tab-preview');
  if (tab === 'form') {
    form.classList.remove('mob-hidden'); preview.classList.add('mob-hidden');
    btnF?.classList.add('active');       btnP?.classList.remove('active');
  } else {
    form.classList.add('mob-hidden');    preview.classList.remove('mob-hidden');
    btnF?.classList.remove('active');    btnP?.classList.add('active');
  }
}

// ══════════════════════════════════════════════════════════════
// LECTEUR D'ENTRÉE
// ══════════════════════════════════════════════════════════════

function openEntryReader(entryId) {
  const entry = (chrEntries[activeChrId] || []).find(e => e.id === entryId);
  if (!entry) return;
  const chr = chronicles[activeChrId] || followedChronicles[activeChrId];
  const isOwn = !!chronicles[activeChrId];
  const date = entry.created_at
    ? new Date(entry.created_at).toLocaleDateString(currentLang === 'en' ? 'en-GB' : 'fr-FR', { day:'numeric', month:'long', year:'numeric' })
    : '';
  document.getElementById('entry-reader-content').innerHTML = `
    <div class="chr-reader-breadcrumb" onclick="showChrDetail('${activeChrId}')">
      ← ${esc(chr?.title || 'Chronique')}
    </div>
    <h1 class="chr-reader-title">${esc(entry.title)}</h1>
    <div class="chr-reader-meta">${date}</div>
    <div class="chr-reader-body">${entry.content ? renderMarkdown(entry.content) : ''}</div>
    <div class="chr-reader-likes">
      <button id="entry-like-btn" class="entry-like-btn${entry.liked_by_me ? ' liked' : ''}"
        ${isOwn ? 'disabled' : `onclick="toggleEntryLike('${entry.id}')"`}
        title="${isOwn ? t('entry_like_own_disabled') : t('entry_like_title')}">
        ${HEART_SVG}
        <span class="entry-like-count">${entry.like_count || 0}</span>
      </button>
    </div>
  `;
  showView('entry-reader');
  if (!chronicles[activeChrId]) unreadMarkers.markEntryRead(activeChrId, entryId);
  unreadMarkers.refreshNavBadges({ followedChars, followedDocuments, followedChronicles, chrEntries });
  setHash('entry', activeChrId, entryId);
}

async function toggleEntryLike(entryId) {
  const entry = (chrEntries[activeChrId] || []).find(e => e.id === entryId);
  if (!entry || !currentUser || chronicles[activeChrId]) return;
  const wasLiked = !!entry.liked_by_me;
  entry.liked_by_me = !wasLiked;
  entry.like_count  = Math.max(0, (entry.like_count || 0) + (wasLiked ? -1 : 1));
  updateEntryLikeUI(entry);
  updateChronicleLikeTotal(activeChrId, wasLiked ? -1 : 1);

  const { error } = wasLiked
    ? await sb.from('chronicle_entry_likes').delete().eq('entry_id', entryId).eq('user_id', currentUser.id)
    : await sb.from('chronicle_entry_likes').insert({ entry_id: entryId, user_id: currentUser.id });

  if (error) {
    entry.liked_by_me = wasLiked;
    entry.like_count  = Math.max(0, (entry.like_count || 0) + (wasLiked ? 1 : -1));
    updateEntryLikeUI(entry);
    updateChronicleLikeTotal(activeChrId, wasLiked ? 1 : -1);
    showToast(t('toast_like_error'));
  }
}

function updateEntryLikeUI(entry) {
  const btn = document.getElementById('entry-like-btn');
  if (!btn) return;
  btn.classList.toggle('liked', !!entry.liked_by_me);
  const countEl = btn.querySelector('.entry-like-count');
  if (countEl) countEl.textContent = entry.like_count || 0;
}

function updateChronicleLikeTotal(chrId, delta) {
  const chr = chronicles[chrId] || followedChronicles[chrId];
  if (!chr) return;
  chr.like_count = Math.max(0, (chr.like_count || 0) + delta);
  const badge = document.getElementById('chr-detail-like-badge');
  if (badge) badge.innerHTML = chrLikeBadgeHTML(chr.like_count);
}

function shareEntryReaderBtn() {
  if (!activeChrId) return;
  const chr = chronicles[activeChrId] || followedChronicles[activeChrId];
  if (!chr?.is_public) { showToast(t('toast_chr_share_need_public')); return; }
  const hash = window.location.hash.slice(1);
  if (hash.startsWith('entry/')) {
    const entryId = hash.split('/')[2];
    copyUrl(buildShareUrl('entry', activeChrId, entryId));
  }
}

// ══════════════════════════════════════════════════════════════
// ILLUSTRATION — CHRONIQUE
// ══════════════════════════════════════════════════════════════

function chrIllusZoneClick() {
  if (!chrState.illustration_url) document.getElementById('chr-illus-input').click();
}

function setChrIllusPreview(url, position) {
  const img         = document.getElementById('chr-illus-preview-img');
  const placeholder = document.getElementById('chr-illus-placeholder');
  const zone        = document.getElementById('chr-illus-zone');
  const sliderWrap  = document.getElementById('chr-illus-slider-wrap');
  const slider      = document.getElementById('chr-illus-pos-slider');
  const pos = position !== undefined ? position : (chrState?.illustration_position || 0);
  if (url) {
    img.src = url; img.style.display = 'block';
    img.style.objectPosition = `center ${pos}%`;
    placeholder.style.display = 'none';
    zone.classList.add('has-image');
    sliderWrap.classList.add('visible');
    slider.value = pos;
  } else {
    img.src = ''; img.style.display = 'none';
    placeholder.style.display = 'flex';
    zone.classList.remove('has-image');
    sliderWrap.classList.remove('visible');
    slider.value = 0;
  }
}

function updateChrIllusPosition(val) {
  chrState.illustration_position = parseInt(val);
  const img = document.getElementById('chr-illus-preview-img');
  if (img) img.style.objectPosition = `center ${val}%`;
}

async function uploadChrIllustration(input) {
  const file = input.files[0];
  if (!file) return;
  if (!currentUser) { showToast(t('toast_upload_no_user')); return; }
  if (file.size > 3 * 1024 * 1024) { showToast(t('toast_illus_too_large')); return; }

  document.getElementById('chr-illus-uploading').classList.add('active');
  if (chrIllusStaging) await discardStagedIllustration('character-illustrations', chrIllusStaging);
  const blob = await compressImage(file);
  const { path, url, error } = await stageIllustrationUpload('character-illustrations', currentUser.id, blob);
  document.getElementById('chr-illus-uploading').classList.remove('active');
  if (error) { showToast(t('toast_illus_upload_error') + error.message); return; }

  chrIllusStaging = path;
  chrState.illustration_url      = url;
  chrState.illustration_position = 0;
  setChrIllusPreview(chrState.illustration_url, 0);
  showToast(t('toast_illus_added'));
  input.value = '';
}

async function removeChrIllustration() {
  if (!chrState.illustration_url) return;
  if (chrIllusStaging) {
    await discardStagedIllustration('character-illustrations', chrIllusStaging);
    chrIllusStaging = null;
    chrState.illustration_url      = '';
    chrState.illustration_position = 0;
    setChrIllusPreview('', 0);
    return;
  }
  await deleteStorageFile(chrState.illustration_url);
  chrState.illustration_url      = '';
  chrState.illustration_position = 0;
  setChrIllusPreview('', 0);
}
