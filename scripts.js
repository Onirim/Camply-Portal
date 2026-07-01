// ══════════════════════════════════════════════════════════════
// Camply TTRPG Manager — Core
// Auth, DB, vues, roster, illustration, routing
// ══════════════════════════════════════════════════════════════

// ── État global ───────────────────────────────────────────────
let currentUser      = null;
let currentUniverse  = null;
let userUniverses    = [];
let isAppReady       = false;
let chars            = {};
let editingId        = null;
let state            = null;
let allTags          = [];
let activeTagFilters = [];
let charTagMap       = {};
let followedChars    = {};
let followedTagMap   = {};
let filterFollowed   = false;
let charSecrets = {}; 
let currentSecretDraft = '';

function normalizeDiscordName(name) {
  return (name || '')
    .trim()
    .replace(/^@+/, '')
    .replace(/#\d+$/, '')
    .toLowerCase();
}

function getDiscordUsername(user) {
  const meta = user?.user_metadata || {};
  const raw = meta.full_name
    || meta.name
    || meta.username
    || (user?.email ? user.email.split('@')[0] : '')
    || 'Joueur';
  return raw.replace(/#\d+$/, '');
}

function getCurrentDiscordNames() {
  if (!currentUser) return [];
  const meta = currentUser.user_metadata || {};
  const displayedName = meta.full_name
    || meta.name
    || meta.username
    || (currentUser.email ? currentUser.email.split('@')[0] : '');
  return [displayedName]
    .map(normalizeDiscordName)
    .filter(Boolean);
}

function isAppAdmin() {
  const admins = (globalThis.APP_CONFIG?.adminDiscordUsers || [])
    .map(normalizeDiscordName)
    .filter(Boolean);
  if (!admins.length) return false;
  const names = getCurrentDiscordNames();
  return names.some(n => admins.includes(n));
}

// MJ de l'univers courant (ou propriétaire, ou admin site legacy) :
// droit d'édition sur les objets publics partagés via une campagne
// commune, en plus de ses propres objets.
function isUniverseGM() {
  return isAppAdmin() || currentUniverse?.role === 'gm' || currentUniverse?.role === 'owner';
}

// ══════════════════════════════════════════════════════════════
// AUTH
// ══════════════════════════════════════════════════════════════

async function doDiscordLogin() {
  if (window.installAssistant) {
    const installationOk = await installAssistant.runChecks();
    if (!installationOk) return;
  }
  const btn   = document.getElementById('btn-discord');
  const errEl = document.getElementById('discord-error');
  errEl.classList.remove('show');
  btn.disabled = true;
  btn.innerHTML = `<span style="opacity:0.7">${t('auth_redirecting')}</span>`;
  const { error } = await sb.auth.signInWithOAuth({
    provider: 'discord',
    options: { redirectTo: window.location.origin + window.location.pathname }
  });
  if (error) {
    errEl.textContent = t('auth_error_prefix') + error.message;
    errEl.classList.add('show');
    btn.disabled = false;
    btn.innerHTML = discordBtnInner();
  }
}

function switchAuthTab(tab) {
  const isDiscord = tab === 'discord';
  document.getElementById('auth-panel-discord').style.display = isDiscord ? 'block' : 'none';
  document.getElementById('auth-panel-email').style.display   = isDiscord ? 'none'  : 'block';
  document.getElementById('auth-tab-discord').style.color       = isDiscord ? 'var(--accent)' : 'var(--text3)';
  document.getElementById('auth-tab-discord').style.borderBottomColor = isDiscord ? 'var(--accent)' : 'transparent';
  document.getElementById('auth-tab-email').style.color         = isDiscord ? 'var(--text3)' : 'var(--accent)';
  document.getElementById('auth-tab-email').style.borderBottomColor   = isDiscord ? 'transparent' : 'var(--accent)';
  document.getElementById('discord-error').classList.remove('show');
  document.getElementById('email-success').classList.remove('show');
}

async function doEmailLogin() {
  const email = document.getElementById('auth-email-input').value.trim();
  const errEl = document.getElementById('discord-error');
  const sucEl = document.getElementById('email-success');
  errEl.classList.remove('show');
  sucEl.classList.remove('show');

  if (!email || !email.includes('@')) {
    errEl.textContent = 'Veuillez saisir une adresse email valide.';
    errEl.classList.add('show');
    return;
  }

  const { error } = await sb.auth.signInWithOtp({
    email,
    options: { emailRedirectTo: window.location.origin + window.location.pathname }
  });

  if (error) {
    errEl.textContent = 'Erreur : ' + error.message;
    errEl.classList.add('show');
  } else {
    sucEl.classList.add('show');
    document.getElementById('auth-email-input').value = '';
  }
}

function discordBtnInner() {
  return `<svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
    <path d="M20.317 4.37a19.791 19.791 0 0 0-4.885-1.515.074.074 0 0 0-.079.037c-.21.375-.444.864-.608 1.25a18.27 18.27 0 0 0-5.487 0 12.64 12.64 0 0 0-.617-1.25.077.077 0 0 0-.079-.037A19.736 19.736 0 0 0 3.677 4.37a.07.07 0 0 0-.032.027C.533 9.046-.32 13.58.099 18.057c.002.022.015.043.03.056a19.9 19.9 0 0 0 5.993 3.03.078.078 0 0 0 .084-.028c.462-.63.874-1.295 1.226-1.994a.076.076 0 0 0-.041-.106 13.107 13.107 0 0 1-1.872-.892.077.077 0 0 1-.008-.128 10.2 10.2 0 0 0 .372-.292.074.074 0 0 1 .077-.01c3.928 1.793 8.18 1.793 12.062 0a.074.074 0 0 1 .078.01c.12.098.246.198.373.292a.077.077 0 0 1-.006.127 12.299 12.299 0 0 1-1.873.892.077.077 0 0 0-.041.107c.36.698.772 1.362 1.225 1.993a.076.076 0 0 0 .084.028 19.839 19.839 0 0 0 6.002-3.03.077.077 0 0 0 .032-.054c.5-5.177-.838-9.674-3.549-13.66a.061.061 0 0 0-.031-.03zM8.02 15.33c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.956-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.956 2.418-2.157 2.418zm7.975 0c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.955-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.946 2.418-2.157 2.418z"/>
  </svg>
  <span data-i18n="auth_login_discord">${t('auth_login_discord')}</span>`;
}

async function doLogout() {
  toggleUserMenu(false);
  await sb.auth.signOut();
}

function toggleUserMenu(force) {
  const dd = document.getElementById('user-dropdown');
  dd.classList.toggle('open', force !== undefined ? force : !dd.classList.contains('open'));
}

document.addEventListener('click', e => {
  const wrap = document.getElementById('user-menu-wrap');
  if (wrap && !wrap.contains(e.target)) toggleUserMenu(false);
});

function updateUserUI(user) {
  if (!user) return;
  const username = getDiscordUsername(user);
  document.getElementById('user-avatar').textContent = username.charAt(0).toUpperCase();
  document.getElementById('user-label').textContent  = username;
  document.getElementById('dd-username').textContent = username;
  document.getElementById('dd-email').textContent    = user.email || '';
}

// ══════════════════════════════════════════════════════════════
// DB — PERSONNAGES
// ══════════════════════════════════════════════════════════════

async function loadCharsFromDB() {
  const { data, error } = await sb
    .from('characters')
    .select('id, name, rank, is_public, user_id, data, updated_at')
    .eq('universe_id', currentUniverse.id)
    .order('updated_at', { ascending: false });
  if (error) { console.error('Erreur chargement:', error); return; }

  const ownerIds = [...new Set((data || []).filter(r => r.user_id !== currentUser.id).map(r => r.user_id))];
  let ownerMap = {};
  if (ownerIds.length) {
    const { data: profiles } = await sb.from('profiles').select('id, username').in('id', ownerIds);
    (profiles || []).forEach(p => { ownerMap[p.id] = p.username; });
  }

  chars = {};
  followedChars = {};
  (data || []).forEach(row => {
    const entry = {
      ...row.data,
      name: row.name, rank: row.rank,
      is_public: row.is_public, _db_id: row.id,
    };
    if (row.user_id === currentUser.id) {
      chars[row.id] = entry;
    } else {
      followedChars[row.id] = { ...entry, _followed: true, _owner_name: ownerMap[row.user_id] || '?', _owner_id: row.user_id };
    }
  });
  await loadTagsFromDB();
}

async function saveCharToDB() {
  if (!state.name.trim()) { alert(t('alert_char_no_name')); return; }
  setSaveIndicator('saving', t('save_saving'));
  const isEditingFollowedChar = !!(editingId && followedChars[editingId] && isUniverseGM());
  const payload = {
    name:      state.name.trim(),
    rank:      state.rank,
    is_public: state.is_public || false,
    data:      state,
  };
  const isValidUUID = editingId &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(editingId);
  const result = isValidUUID
    ? await sb.from('characters').update(payload).eq('id', editingId).eq('universe_id', currentUniverse.id).select('id').single()
    : await sb.from('characters').insert({ ...payload, user_id: currentUser.id, universe_id: currentUniverse.id }).select('id').single();
  if (!isValidUUID && editingId) editingId = null;
  if (result.error) {
    setSaveIndicator('error', t('save_error'));
    showToast(t('toast_char_save_error'));
    return;
  }
  editingId = result.data.id;
  await saveCharSecretToDB(editingId, currentSecretDraft);
  if (!isEditingFollowedChar) {
    await saveCharTagsToDB(editingId);
    chars[editingId] = { ...state, _db_id: editingId, _owner_id: currentUser.id };
    charTagMap[editingId] = (state.tags || []).map(tg => tg.id);
  } else if (followedChars[editingId]) {
    followedChars[editingId] = {
      ...followedChars[editingId],
      ...state,
      _db_id: editingId,
      _owner_id: followedChars[editingId]._owner_id || null,
    };
  }
  setSaveIndicator('saved', t('save_saved'));
  showToast(t('toast_char_saved'));
}

async function deleteCharFromDB(id) {
  const name = chars[id]?.name || '';
  if (!confirm(ti('confirm_delete_char', { name }))) return;
  const tagIds         = charTagMap[id] || [];
  const illustrationUrl = chars[id]?.illustration_url || '';
  const { error } = await sb.from('characters').delete().eq('id', id).eq('universe_id', currentUniverse.id);
  if (error) { showToast(t('toast_char_deleted_error')); return; }
  delete chars[id];
  delete charTagMap[id];
  if (illustrationUrl) await deleteStorageFile(illustrationUrl);
  for (const tagId of tagIds) {
  const { count: c1 } = await sb.from('character_tags')
    .select('*', { count:'exact', head:true }).eq('tag_id', tagId);
  const { count: c2 } = await sb.from('followed_character_tags')
    .select('*', { count:'exact', head:true }).eq('tag_id', tagId);
  if ((c1 + c2) === 0) {
    await sb.from('tags').delete().eq('id', tagId);
    allTags = allTags.filter(tg => tg.id !== tagId);
  }
}
  renderList();
}

// ══════════════════════════════════════════════════════════════
// DB — TAGS
// ══════════════════════════════════════════════════════════════

async function loadTagsFromDB() {
  const { data: tags } = await sb.from('tags')
    .select('*').eq('user_id', currentUser.id).eq('universe_id', currentUniverse.id).order('name');
  allTags = tags || [];
  const ownCharIds = Object.keys(chars);
  charTagMap = {};
  if (ownCharIds.length) {
    const { data: charTags } = await sb.from('character_tags')
      .select('character_id, tag_id').in('character_id', ownCharIds);
    (charTags || []).forEach(({ character_id, tag_id }) => {
      if (!charTagMap[character_id]) charTagMap[character_id] = [];
      charTagMap[character_id].push(tag_id);
    });
  }
  const { data: followedTags } = await sb.from('followed_character_tags')
    .select('character_id, tag_id').eq('user_id', currentUser.id).eq('universe_id', currentUniverse.id);
  followedTagMap = {};
  (followedTags || []).forEach(({ character_id, tag_id }) => {
    if (!followedTagMap[character_id]) followedTagMap[character_id] = [];
    followedTagMap[character_id].push(tag_id);
  });
}

// ══════════════════════════════════════════════════════════════
// DB — NOTE SECRÈTE PERSONNELLE (par joueur, sur n'importe quel perso)
// ══════════════════════════════════════════════════════════════

async function loadCharSecret(charId) {
  if (!charId || !currentUser) return '';
  if (charSecrets[charId] !== undefined) return charSecrets[charId];
  const { data, error } = await sb.from('character_secrets')
    .select('content')
    .eq('character_id', charId)
    .eq('user_id', currentUser.id)
    .eq('universe_id', currentUniverse.id)
    .maybeSingle();
  if (error) { console.warn('loadCharSecret:', error.message); charSecrets[charId] = ''; return ''; }
  charSecrets[charId] = data?.content || '';
  return charSecrets[charId];
}

async function saveCharSecretToDB(charId, content) {
  if (!charId || !currentUser) return;
  const { error } = await sb.from('character_secrets')
    .upsert(
      { character_id: charId, user_id: currentUser.id, universe_id: currentUniverse.id, content: content || '' },
      { onConflict: 'universe_id,character_id,user_id' }
    );
  if (error) { console.error('saveCharSecretToDB:', error.message); showToast(t('toast_secret_save_error')); return; }
  charSecrets[charId] = content || '';
  showToast(t('toast_secret_saved'));
}

// ══════════════════════════════════════════════════════════════
// INIT
// ══════════════════════════════════════════════════════════════

async function init() {
  if (window.installAssistant) {
    const installationOk = await installAssistant.runChecks();
    if (!installationOk) return;
  }
  const safetyTimer = setTimeout(() => onSignedOut(), 5000);
  try {
    const { data: { session } } = await sb.auth.getSession();
    clearTimeout(safetyTimer);
    if (session?.user) await onSignedIn(session.user);
    else onSignedOut();
  } catch (e) {
    clearTimeout(safetyTimer);
    onSignedOut();
  }
  sb.auth.onAuthStateChange(async (event, session) => {
    if (event === 'SIGNED_IN' && !isAppReady) await onSignedIn(session.user);
    else if (event === 'SIGNED_OUT') { isAppReady = false; onSignedOut(); }
  });
}

async function onSignedIn(user) {
  currentUser = user;
  currentUniverse = null;
  userUniverses = [];
  isAppReady = false;
  updateUserUI(currentUser);
  const username = getDiscordUsername(user);
  await sb.from('profiles').upsert({ id: user.id, username });
  document.getElementById('auth-screen').classList.remove('active');
  document.getElementById('app').style.display = 'none';
  document.getElementById('loading-overlay').classList.add('active');
  await loadUniversesFromDB();
  document.getElementById('loading-overlay').classList.remove('active');
  showUniverseScreen();
}

async function loadUniversesFromDB() {
  if (!currentUser) return [];
  const errEl = document.getElementById('universe-error');
  if (errEl) errEl.classList.remove('show');

  const { data: universes, error } = await sb
    .from('universes')
    .select('id, owner_id, name, description, illustration_url, illustration_position, theme_name, created_at, updated_at')
    .order('updated_at', { ascending: false });

  if (error) {
    console.error('Erreur chargement univers:', error);
    userUniverses = [];
    if (errEl) {
      errEl.textContent = 'Impossible de charger les univers : ' + error.message;
      errEl.classList.add('show');
    }
    renderUniverseList();
    return [];
  }

  const universeIds = (universes || []).map(u => u.id);
  let roleByUniverse = {};
  if (universeIds.length) {
    const { data: memberships, error: membershipError } = await sb
      .from('universe_members')
      .select('universe_id, role')
      .eq('user_id', currentUser.id)
      .in('universe_id', universeIds);
    if (membershipError) console.warn('Erreur chargement rôles univers:', membershipError.message);
    (memberships || []).forEach(m => { roleByUniverse[m.universe_id] = m.role; });
  }

  userUniverses = (universes || []).map(u => ({
    ...u,
    role: roleByUniverse[u.id] || (u.owner_id === currentUser.id ? 'owner' : 'player'),
  }));
  renderUniverseList();
  return userUniverses;
}

function showUniverseScreen() {
  document.getElementById('loading-overlay').classList.remove('active');
  document.getElementById('auth-screen').classList.remove('active');
  document.getElementById('app').style.display = 'none';
  document.getElementById('universe-screen')?.classList.add('active');
  closeUniverseCreateForm();
  renderUniverseList();
  applyTranslations();
  applyTheme('');
}

function renderUniverseList() {
  const list = document.getElementById('universe-list');
  if (!list) return;
  if (!userUniverses.length) {
    list.innerHTML = `<div class="universe-empty">Aucun univers disponible.<br>Créez votre premier univers pour commencer.</div>`;
    return;
  }
  list.innerHTML = userUniverses.map(u => `
    <button class="universe-card" onclick="enterUniverse('${u.id}')">
      ${u.illustration_url ? `<img class="card-illus" src="${esc(u.illustration_url)}" style="object-position:center ${u.illustration_position || 0}%" alt="">` : ''}
      <div class="universe-card-title">${esc(u.name)}</div>
      <div class="universe-card-desc">${esc(u.description || 'Aucune description')}</div>
      <div class="universe-card-meta">
        <span>${esc(u.role || 'membre')}</span>
      </div>
    </button>
  `).join('');
}

// ── Création d'univers ───────────────────────────────────────
let universeFormState = { name: '', description: '', illustration_url: '', illustration_position: 0 };

function openUniverseCreateForm() {
  universeFormState = { name: '', description: '', illustration_url: '', illustration_position: 0 };
  document.getElementById('universe-f-name').value = '';
  document.getElementById('universe-f-description').value = '';
  const username = getDiscordUsername(currentUser);
  document.getElementById('universe-f-owner').value = username;
  setUniverseIllusPreview('', 0);
  const errEl = document.getElementById('universe-create-error');
  if (errEl) errEl.classList.remove('show');
  document.getElementById('universe-list-view').style.display = 'none';
  document.getElementById('universe-create-view').style.display = 'block';
}

function closeUniverseCreateForm() {
  document.getElementById('universe-create-view').style.display = 'none';
  document.getElementById('universe-list-view').style.display = 'block';
}

function universeIllusZoneClick() {
  if (!universeFormState.illustration_url) document.getElementById('universe-illus-input').click();
}

function setUniverseIllusPreview(url, position) {
  const img         = document.getElementById('universe-illus-preview-img');
  const placeholder = document.getElementById('universe-illus-placeholder');
  const zone        = document.getElementById('universe-illus-zone');
  const sliderWrap  = document.getElementById('universe-illus-slider-wrap');
  const slider      = document.getElementById('universe-illus-pos-slider');
  const pos = position !== undefined ? position : (universeFormState.illustration_position || 0);
  if (url) {
    img.src = url; img.style.display = 'block';
    img.style.objectPosition = `center ${pos}%`;
    placeholder.style.display = 'none';
    zone.classList.add('has-image');
    sliderWrap.classList.add('visible'); slider.value = pos;
  } else {
    img.src = ''; img.style.display = 'none';
    placeholder.style.display = 'flex';
    zone.classList.remove('has-image');
    sliderWrap.classList.remove('visible'); slider.value = 0;
  }
}

function updateUniverseIllusPosition(val) {
  universeFormState.illustration_position = parseInt(val);
  const img = document.getElementById('universe-illus-preview-img');
  if (img) img.style.objectPosition = `center ${val}%`;
}

async function uploadUniverseIllustration(input) {
  const file = input.files[0];
  if (!file) return;
  if (!currentUser) { showToast(t('toast_upload_no_user')); return; }
  if (file.size > 3 * 1024 * 1024) { showToast(t('toast_illus_too_large')); return; }
  document.getElementById('universe-illus-uploading').classList.add('active');
  const oldUrl = universeFormState.illustration_url || '';
  const path   = `${currentUser.id}/universe_tmp_${Date.now()}.jpg`;
  const blob   = await compressImage(file);
  const { error } = await sb.storage
    .from('character-illustrations').upload(path, blob, { upsert: true, contentType: 'image/jpeg' });
  document.getElementById('universe-illus-uploading').classList.remove('active');
  if (error) { showToast(t('toast_illus_upload_error') + error.message); return; }
  if (oldUrl && !oldUrl.includes(path)) await deleteStorageFile(oldUrl);
  const { data } = sb.storage.from('character-illustrations').getPublicUrl(path);
  universeFormState.illustration_url      = `${data.publicUrl}?v=${Date.now()}`;
  universeFormState.illustration_position = 0;
  setUniverseIllusPreview(universeFormState.illustration_url, 0);
  showToast(t('toast_illus_added'));
  input.value = '';
}

async function removeUniverseIllustration() {
  if (!universeFormState.illustration_url) return;
  await deleteStorageFile(universeFormState.illustration_url);
  universeFormState.illustration_url      = '';
  universeFormState.illustration_position = 0;
  setUniverseIllusPreview('', 0);
}

async function submitCreateUniverse() {
  const errEl = document.getElementById('universe-create-error');
  const name  = document.getElementById('universe-f-name').value.trim();
  if (!name) {
    if (errEl) { errEl.textContent = 'Le nom de l’univers est requis.'; errEl.classList.add('show'); }
    return;
  }
  const description = document.getElementById('universe-f-description').value.trim();
  if (errEl) errEl.classList.remove('show');

  document.getElementById('loading-overlay').classList.add('active');
  const { data, error } = await sb.rpc('create_universe', {
    p_name: name,
    p_description: description,
    p_illustration_url: universeFormState.illustration_url || '',
    p_illustration_position: universeFormState.illustration_position || 0,
  });
  document.getElementById('loading-overlay').classList.remove('active');
  if (error) {
    console.error('Erreur création univers:', error);
    if (errEl) { errEl.textContent = 'Impossible de créer l’univers : ' + error.message; errEl.classList.add('show'); }
    return;
  }
  await loadUniversesFromDB();
  closeUniverseCreateForm();
  if (data?.id) await enterUniverse(data.id);
}

async function enterUniverse(universeId) {
  const universe = userUniverses.find(u => u.id === universeId);
  if (!universe) {
    showToast('Univers introuvable.');
    return;
  }
  currentUniverse = universe;
  updateConfigNavVisibility();
  await loadThemeManifest();
  applyTheme(currentUniverse.theme_name || '');
  document.getElementById('universe-screen')?.classList.remove('active');
  document.getElementById('loading-overlay').classList.add('active');
  document.getElementById('app').style.display = 'flex';
  try {
    await loadUniverseData();
  } finally {
    document.getElementById('loading-overlay').classList.remove('active');
  }
}

async function loadUniverseData() {
  if (!currentUniverse?.id) {
    showUniverseScreen();
    return;
  }
  await unreadMarkers.initFromDB(currentUser.id, currentUniverse.id);
  await Promise.all([
    loadCharsFromDB(),
    loadChroniclesFromDB(),
    loadDocumentsFromDB(),
  ]);
  await Promise.all([
    loadCampaignsFromDB(),
    (typeof ensureMapLayersCacheLoaded === 'function'
      ? ensureMapLayersCacheLoaded()
      : Promise.resolve()),
  ]);
  unreadMarkers.refreshNavBadges({ followedChars, followedDocuments, followedChronicles, chrEntries });
  isAppReady = true;
  if (!navigateFromHash()) {
    renderList();
    showView('list');
  }
}

// ══════════════════════════════════════════════════════════════
// CONFIGURATION DE L'UNIVERS COURANT (propriétaire uniquement)
// ══════════════════════════════════════════════════════════════

let universeConfigState = { name: '', description: '', illustration_url: '', illustration_position: 0, theme_name: '' };

// ══════════════════════════════════════════════════════════════
// THÈME DE L'UNIVERS
// ══════════════════════════════════════════════════════════════

let themeManifest = null;

async function loadThemeManifest() {
  if (themeManifest) return themeManifest;
  try {
    const res = await fetch('./themes/manifest.json');
    themeManifest = await res.json();
  } catch (e) {
    console.error('Erreur chargement manifest des thèmes:', e);
    themeManifest = [];
  }
  return themeManifest;
}

function applyTheme(themeId) {
  const link = document.getElementById('theme-stylesheet');
  if (!link) return;
  const theme = (themeManifest || []).find(t => t.id === themeId);
  if (!theme) {
    link.href = '';
    link.disabled = true;
    return;
  }
  link.href = `./themes/${theme.file}`;
  link.disabled = false;
}

async function populateConfigThemeSelect(selectedId) {
  const select = document.getElementById('config-f-theme');
  if (!select) return;
  const themes = await loadThemeManifest();
  select.innerHTML = `<option value="">${t('config_theme_default')}</option>` +
    themes.map(theme => `<option value="${esc(theme.id)}">${esc(theme.label)}</option>`).join('');
  select.value = selectedId || '';
}

function onConfigThemeChange(themeId) {
  universeConfigState.theme_name = themeId;
  applyTheme(themeId);
}

function canConfigureUniverse() {
  return currentUniverse?.role === 'owner';
}

function updateConfigNavVisibility() {
  const btn = document.getElementById('nav-config');
  if (btn) btn.style.display = canConfigureUniverse() ? '' : 'none';
}

function openUniverseConfigView() {
  if (!canConfigureUniverse() || !currentUniverse) return;
  universeConfigState = {
    name: currentUniverse.name || '',
    description: currentUniverse.description || '',
    illustration_url: currentUniverse.illustration_url || '',
    illustration_position: currentUniverse.illustration_position || 0,
    theme_name: currentUniverse.theme_name || '',
  };
  document.getElementById('config-f-name').value = universeConfigState.name;
  document.getElementById('config-f-description').value = universeConfigState.description;
  setConfigIllusPreview(universeConfigState.illustration_url, universeConfigState.illustration_position);
  populateConfigThemeSelect(universeConfigState.theme_name);
  const errEl = document.getElementById('config-error');
  if (errEl) errEl.classList.remove('show');
  const inviteErrEl = document.getElementById('config-invite-error');
  if (inviteErrEl) inviteErrEl.classList.remove('show');
  const inviteInput = document.getElementById('config-invite-input');
  if (inviteInput) inviteInput.value = '';
  loadUniverseMembersForConfig();
  loadMapsForConfig();
}

// ══════════════════════════════════════════════════════════════
// MEMBRES DE L'UNIVERS (configuration)
// ══════════════════════════════════════════════════════════════

async function loadUniverseMembersForConfig() {
  if (!currentUniverse) return;
  const { data, error } = await sb.from('universe_members')
    .select('user_id, role, joined_at')
    .eq('universe_id', currentUniverse.id)
    .order('joined_at', { ascending: true });
  if (error) { console.error('Erreur chargement membres:', error); return; }

  const userIds = (data || []).map(r => r.user_id);
  let ownerMap = {};
  if (userIds.length) {
    const { data: profiles } = await sb.from('profiles').select('id, username').in('id', userIds);
    (profiles || []).forEach(p => { ownerMap[p.id] = p.username; });
  }

  const members = (data || []).map(r => ({ ...r, username: ownerMap[r.user_id] || '?' }));
  renderUniverseMembersList(members);
  populateTransferSelect(members);
}

function populateTransferSelect(members) {
  const select = document.getElementById('config-transfer-select');
  if (!select) return;
  const candidates = members.filter(m => m.user_id !== currentUniverse.owner_id);
  if (!candidates.length) {
    select.innerHTML = `<option value="">${t('config_transfer_empty')}</option>`;
    select.disabled = true;
    return;
  }
  select.disabled = false;
  select.innerHTML = `<option value="">${t('config_transfer_select_placeholder')}</option>` +
    candidates.map(m => `<option value="${esc(m.user_id)}">${esc(m.username)}</option>`).join('');
}

async function transferUniverseOwnership() {
  if (!canConfigureUniverse() || !currentUniverse) return;
  const select = document.getElementById('config-transfer-select');
  const errEl  = document.getElementById('config-transfer-error');
  if (errEl) errEl.classList.remove('show');
  const newOwnerId = select?.value;
  if (!newOwnerId) return;
  const username = select.options[select.selectedIndex]?.textContent || '';

  if (!confirm(ti('confirm_transfer_ownership', { username }))) return;

  const { error } = await sb.rpc('transfer_universe_ownership', {
    p_universe_id: currentUniverse.id,
    p_new_owner_id: newOwnerId,
  });
  if (error) {
    if (errEl) { errEl.textContent = error.message; errEl.classList.add('show'); }
    return;
  }

  showToast(ti('toast_transfer_success', { username }));
  await loadUniversesFromDB();
  currentUniverse = userUniverses.find(u => u.id === currentUniverse.id) || null;
  updateConfigNavVisibility();
  showView('list');
}

// ══════════════════════════════════════════════════════════════
// SUPPRESSION DE L'UNIVERS
// ══════════════════════════════════════════════════════════════

function openDeleteUniverseModal() {
  if (!canConfigureUniverse() || !currentUniverse) return;
  const input = document.getElementById('delete-universe-confirm-input');
  const errEl = document.getElementById('delete-universe-error-msg');
  const label = document.getElementById('delete-universe-type-label');
  if (input) input.value = '';
  if (errEl) errEl.style.display = 'none';
  if (label) label.textContent = ti('delete_universe_type_label', { name: currentUniverse.name });
  _refreshDeleteUniverseConfirmState();
  document.getElementById('delete-universe-modal').style.display = 'flex';
}

function closeDeleteUniverseModal() {
  const modal = document.getElementById('delete-universe-modal');
  if (modal) modal.style.display = 'none';
}

function _refreshDeleteUniverseConfirmState() {
  const input = document.getElementById('delete-universe-confirm-input');
  const btn   = document.getElementById('delete-universe-confirm-btn');
  if (!btn || !currentUniverse) return;
  btn.disabled = (input?.value || '') !== currentUniverse.name;
}

function _extractStoragePath(url, bucket) {
  if (!url) return null;
  const match = url.match(new RegExp(bucket + '/([^?#]+)'));
  return match ? match[1] : null;
}

async function confirmDeleteUniverse() {
  if (!canConfigureUniverse() || !currentUniverse) return;
  const input = document.getElementById('delete-universe-confirm-input');
  const errEl = document.getElementById('delete-universe-error-msg');
  const btn   = document.getElementById('delete-universe-confirm-btn');
  if ((input?.value || '') !== currentUniverse.name) return;
  if (errEl) errEl.style.display = 'none';

  const universeId   = currentUniverse.id;
  const universeName = currentUniverse.name;
  if (btn) btn.disabled = true;

  // Le RPC (SECURITY DEFINER) supprime l'univers en cascade et renvoie
  // toutes les URLs d'illustration à nettoyer côté storage, y compris
  // celles des éléments privés créés par d'autres membres.
  const { data: illustrationUrls, error } = await sb.rpc('delete_universe', { p_universe_id: universeId });
  if (error) {
    if (errEl) { errEl.textContent = error.message; errEl.style.display = 'flex'; }
    if (btn) btn.disabled = false;
    return;
  }

  // Nettoyage du storage en best-effort : la ligne univers est déjà supprimée.
  const charPaths = [...new Set((illustrationUrls || [])
    .map(u => _extractStoragePath(u, 'character-illustrations'))
    .filter(Boolean))];
  if (charPaths.length) {
    sb.storage.from('character-illustrations').remove(charPaths)
      .catch(e => console.warn('Nettoyage storage character-illustrations:', e));
  }
  sb.storage.from('map-images').list(universeId).then(({ data }) => {
    const paths = (data || []).map(f => `${universeId}/${f.name}`);
    if (paths.length) {
      sb.storage.from('map-images').remove(paths)
        .catch(e => console.warn('Nettoyage storage map-images:', e));
    }
  }).catch(e => console.warn('Listage storage map-images:', e));

  closeDeleteUniverseModal();
  currentUniverse = null;
  await loadUniversesFromDB();
  showUniverseScreen();
  showToast(ti('toast_universe_deleted', { name: universeName }));
}

function renderUniverseMembersList(members) {
  const container = document.getElementById('config-members-list');
  if (!container) return;
  if (!members.length) {
    container.innerHTML = `<div style="color:var(--text3);font-size:13px;font-style:italic;padding:8px 0">${t('config_members_empty')}</div>`;
    return;
  }
  container.innerHTML = members.map(m => {
    const isOwner = m.user_id === currentUniverse.owner_id;
    const roleControl = isOwner
      ? `<span class="campaign-owner-label">${t('campaign_owner_tag')}</span>`
      : (m.role === 'player' || m.role === 'gm')
        ? `<select class="member-role-select" onchange="updateUniverseMemberRole('${m.user_id}', this.value)">
            <option value="player" ${m.role === 'player' ? 'selected' : ''}>${t('role_player')}</option>
            <option value="gm" ${m.role === 'gm' ? 'selected' : ''}>${t('role_gm')}</option>
          </select>`
        : `<span class="member-role-other">${esc(m.role)}</span>`;
    return `<div class="campaign-item-row">
      <div class="campaign-member-avatar">${esc((m.username || '?').slice(0, 1).toUpperCase())}</div>
      <div class="campaign-item-row-name">${esc(m.username)}</div>
      ${roleControl}
      ${!isOwner ? `<button class="icon-btn danger" onclick="removeUniverseMember('${m.user_id}')" title="${t('btn_delete')}">
        <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" width="12" height="12">
          <line x1="3" y1="3" x2="13" y2="13"/><line x1="13" y1="3" x2="3" y2="13"/>
        </svg>
      </button>` : ''}
    </div>`;
  }).join('');
}

async function updateUniverseMemberRole(userId, role) {
  if (!canConfigureUniverse() || !currentUniverse) return;
  const { error } = await sb.from('universe_members')
    .update({ role })
    .eq('universe_id', currentUniverse.id)
    .eq('user_id', userId);
  if (error) { showToast(t('toast_role_update_error')); await loadUniverseMembersForConfig(); return; }
  showToast(t('toast_role_update_success'));
  await loadUniverseMembersForConfig();
}

async function inviteUniverseMember() {
  if (!canConfigureUniverse() || !currentUniverse) return;
  const input  = document.getElementById('config-invite-input');
  const errEl  = document.getElementById('config-invite-error');
  const username = input?.value.trim();
  if (errEl) errEl.classList.remove('show');
  if (!username) return;

  const escapedUsername = username.replace(/[%_\\]/g, '\\$&');
  const { data: profile, error: profileError } = await sb.from('profiles')
    .select('id, username').ilike('username', escapedUsername).maybeSingle();
  if (profileError) console.error('Erreur recherche utilisateur:', profileError);
  if (profileError || !profile) {
    if (errEl) { errEl.textContent = t('toast_invite_user_not_found'); errEl.classList.add('show'); }
    return;
  }
  if (profile.id === currentUser.id) {
    if (errEl) { errEl.textContent = t('toast_invite_self'); errEl.classList.add('show'); }
    return;
  }

  const { error: insertError } = await sb.from('universe_members')
    .insert({ universe_id: currentUniverse.id, user_id: profile.id, role: 'player' });
  if (insertError) {
    const msg = insertError.code === '23505' ? t('toast_invite_already_member') : t('toast_invite_error');
    if (errEl) { errEl.textContent = msg; errEl.classList.add('show'); }
    return;
  }

  if (input) input.value = '';
  await loadUniverseMembersForConfig();
  showToast(ti('toast_invite_success', { username: profile.username }));
}

async function removeUniverseMember(userId) {
  if (!canConfigureUniverse() || !currentUniverse) return;
  if (!confirm(t('confirm_remove_member'))) return;
  const { error } = await sb.from('universe_members')
    .delete().eq('universe_id', currentUniverse.id).eq('user_id', userId);
  if (error) { showToast(t('toast_member_remove_error')); return; }
  await loadUniverseMembersForConfig();
  showToast(t('toast_member_removed'));
}

function configIllusZoneClick() {
  if (!universeConfigState.illustration_url) document.getElementById('config-illus-input').click();
}

function setConfigIllusPreview(url, position) {
  const img         = document.getElementById('config-illus-preview-img');
  const placeholder = document.getElementById('config-illus-placeholder');
  const zone        = document.getElementById('config-illus-zone');
  const sliderWrap  = document.getElementById('config-illus-slider-wrap');
  const slider      = document.getElementById('config-illus-pos-slider');
  const pos = position !== undefined ? position : (universeConfigState.illustration_position || 0);
  if (url) {
    img.src = url; img.style.display = 'block';
    img.style.objectPosition = `center ${pos}%`;
    placeholder.style.display = 'none';
    zone.classList.add('has-image');
    sliderWrap.classList.add('visible'); slider.value = pos;
  } else {
    img.src = ''; img.style.display = 'none';
    placeholder.style.display = 'flex';
    zone.classList.remove('has-image');
    sliderWrap.classList.remove('visible'); slider.value = 0;
  }
}

function updateConfigIllusPosition(val) {
  universeConfigState.illustration_position = parseInt(val);
  const img = document.getElementById('config-illus-preview-img');
  if (img) img.style.objectPosition = `center ${val}%`;
}

async function uploadConfigIllustration(input) {
  const file = input.files[0];
  if (!file) return;
  if (!currentUser) { showToast(t('toast_upload_no_user')); return; }
  if (file.size > 3 * 1024 * 1024) { showToast(t('toast_illus_too_large')); return; }
  document.getElementById('config-illus-uploading').classList.add('active');
  const oldUrl = universeConfigState.illustration_url || '';
  const path   = `${currentUser.id}/universe_${currentUniverse.id}_${Date.now()}.jpg`;
  const blob   = await compressImage(file);
  const { error } = await sb.storage
    .from('character-illustrations').upload(path, blob, { upsert: true, contentType: 'image/jpeg' });
  document.getElementById('config-illus-uploading').classList.remove('active');
  if (error) { showToast(t('toast_illus_upload_error') + error.message); return; }
  if (oldUrl && !oldUrl.includes(path)) await deleteStorageFile(oldUrl);
  const { data } = sb.storage.from('character-illustrations').getPublicUrl(path);
  universeConfigState.illustration_url      = `${data.publicUrl}?v=${Date.now()}`;
  universeConfigState.illustration_position = 0;
  setConfigIllusPreview(universeConfigState.illustration_url, 0);
  showToast(t('toast_illus_added'));
  input.value = '';
}

async function removeConfigIllustration() {
  if (!universeConfigState.illustration_url) return;
  await deleteStorageFile(universeConfigState.illustration_url);
  universeConfigState.illustration_url      = '';
  universeConfigState.illustration_position = 0;
  setConfigIllusPreview('', 0);
}

async function saveUniverseConfig() {
  if (!canConfigureUniverse()) return;
  const errEl = document.getElementById('config-error');
  const name  = document.getElementById('config-f-name').value.trim();
  if (!name) {
    if (errEl) { errEl.textContent = t('config_error_name_required'); errEl.classList.add('show'); }
    return;
  }
  const description = document.getElementById('config-f-description').value.trim();
  if (errEl) errEl.classList.remove('show');

  const { data, error } = await sb.from('universes')
    .update({
      name,
      description,
      illustration_url: universeConfigState.illustration_url || '',
      illustration_position: universeConfigState.illustration_position || 0,
      theme_name: universeConfigState.theme_name || '',
    })
    .eq('id', currentUniverse.id)
    .select('id, owner_id, name, description, illustration_url, illustration_position, theme_name, created_at, updated_at')
    .single();

  if (error) {
    if (errEl) { errEl.textContent = t('toast_config_error') + error.message; errEl.classList.add('show'); }
    return;
  }

  currentUniverse = { ...currentUniverse, ...data };
  const idx = userUniverses.findIndex(u => u.id === currentUniverse.id);
  if (idx >= 0) userUniverses[idx] = { ...userUniverses[idx], ...data };

  showToast(t('toast_config_saved'));
}

function onSignedOut() {
  currentUser = null;
  currentUniverse = null;
  userUniverses = [];
  unreadMarkers.resetCache();
  chars = {};
  charSecrets = {};
  updateConfigNavVisibility();
  applyTheme('');
  document.getElementById('loading-overlay').classList.remove('active');
  document.getElementById('universe-screen')?.classList.remove('active');
  document.getElementById('auth-screen').classList.add('active');
  document.getElementById('app').style.display = 'none';
}

// ══════════════════════════════════════════════════════════════
// VUES
// ══════════════════════════════════════════════════════════════

function showView(view) {
  if (view === 'config' && !canConfigureUniverse()) view = 'list';
  if (view !== 'config' && currentUniverse) applyTheme(currentUniverse.theme_name || '');

  const views = [
    'list', 'editor', 'shared',
    'chronicles', 'chr-detail', 'chr-editor', 'entry-editor', 'entry-reader',
    'documents', 'doc-editor', 'doc-reader',
    'campaigns', 'campaign-detail', 'campaign-editor',
    'map',
    'config',
  ];
  views.forEach(v => document.getElementById('view-' + v)?.classList.toggle('active', v === view));

  const inPer      = ['list', 'editor', 'shared'].includes(view);
  const inChr      = ['chronicles', 'chr-detail', 'chr-editor', 'entry-editor', 'entry-reader'].includes(view);
  const inDoc      = ['documents', 'doc-editor', 'doc-reader'].includes(view);
  const inCampaign = ['campaigns', 'campaign-detail', 'campaign-editor'].includes(view);
  const inMap = view === 'map';
  const inConfig = view === 'config';

  document.getElementById('nav-list').classList.toggle('active', inPer);
  document.getElementById('nav-chronicles').classList.toggle('active', inChr);
  document.getElementById('nav-documents').classList.toggle('active', inDoc);
  document.getElementById('nav-campaigns').classList.toggle('active', inCampaign);
  document.getElementById('nav-map')?.classList.toggle('active', inMap);
  document.getElementById('nav-config')?.classList.toggle('active', inConfig);

  const listViews = ['list', 'chronicles', 'documents', 'campaigns', 'map', 'config'];
  const langSelect = document.getElementById('lang-select');
  const isMobileTopbar = window.matchMedia('(max-width: 768px)').matches;
  const showLangSelect = !isMobileTopbar || listViews.includes(view);
  if (langSelect) langSelect.style.display = showLangSelect ? '' : 'none';

  const si = document.getElementById('save-indicator');
  if (si) si.classList.remove('show');

  if (view === 'editor') {
    const mobilePreviewByDefault = window.matchMedia('(max-width: 768px)').matches;
    switchMobTab(mobilePreviewByDefault ? 'preview' : 'form');
    clearHash();
  }
  if (view === 'list')            { renderList(); clearHash(); }
  if (view === 'chronicles')      { renderChroniclesList(); clearHash(); }
  if (view === 'documents')       { renderDocumentsList(); clearHash(); }
  if (view === 'campaigns')       { renderCampaignsList(); clearHash(); }
  if (view === 'entry-editor')    { switchEntryTab('form'); clearHash(); }
  if (view === 'doc-editor')      { switchDocTab('form'); clearHash(); }
  if (view === 'chr-editor')      clearHash();
  if (view === 'campaign-editor') clearHash();
  if (view === 'map') { clearHash(); initMap(); }
  if (view === 'config') { clearHash(); openUniverseConfigView(); }
  applyTranslations();
  unreadMarkers.refreshNavBadges({ followedChars, followedDocuments, followedChronicles, chrEntries });
}

// ══════════════════════════════════════════════════════════════
// ROSTER — liste et cartes
// ══════════════════════════════════════════════════════════════

function renderList() {
  renderRosterFilters();
  let keys         = Object.keys(chars).sort((a,b) => (chars[a].name||'').localeCompare(chars[b].name||''));
  let followedKeys = Object.keys(followedChars).sort((a,b) => (followedChars[a].name||'').localeCompare(followedChars[b].name||''));
  if (filterFollowed) keys = [];
  if (activeTagFilters.length) {
    keys         = keys.filter(id => activeTagFilters.every(fid => (charTagMap[id] || []).includes(fid)));
    followedKeys = followedKeys.filter(id => activeTagFilters.every(fid => (followedTagMap[id] || []).includes(fid)));
  }
  const total = Object.keys(chars).length + Object.keys(followedChars).length;
  document.getElementById('list-count-badge').textContent = total ? `(${total})` : '';
  const grid  = document.getElementById('char-grid');
  const empty = document.getElementById('empty-state');
  const allKeys = [...keys, ...followedKeys];
  unreadMarkers.refreshNavBadges({ followedChars, followedDocuments, followedChronicles, chrEntries });
  if (!allKeys.length) { grid.innerHTML = ''; empty.style.display = 'flex'; return; }
  empty.style.display = 'none';
  grid.innerHTML = [
    ...keys.map(id         => cardHTML(id, chars[id], false)),
    ...followedKeys.map(id => cardHTML(id, followedChars[id], true)),
  ].join('');
}

function cardHTML(id, c, isFollowed = false) {
  // Le corps de la carte est délégué à game-system.js
  const body     = renderCharCardBody(c);
  const cardTags = _buildTagChips(id, isFollowed ? followedTagMap : charTagMap);

  if (isFollowed) {
    const canAdminEdit = isUniverseGM();
    const unreadDot = unreadMarkers.cardDotHTML(unreadMarkers.isCharacterUnread(id, false));
    return `<div class="char-card" onclick="${canAdminEdit ? `editSharedFollowedChar('${id}')` : `showSharedChar(followedChars['${id}'])`}">${unreadDot}
      ${c.illustration_url ? _cardIllus(c) : ''}
      <div class="card-actions">
        ${canAdminEdit ? `
        <button class="icon-btn" onclick="event.stopPropagation();editSharedFollowedChar('${id}')"
          title="${t('btn_edit')}">
          ${_editIcon()}
        </button>` : ''}
        <button class="icon-btn" onclick="event.stopPropagation();editFollowedTags('${id}')"
          title="${t('card_manage_tags')}">
          <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5">
            <path d="M1 4h14M1 8h10M1 12h6"/>
          </svg>
        </button>
      </div>
      ${body}
      ${cardTags ? `<div class="card-tags">${cardTags}</div>` : ''}
      <div class="followed-badge">${t('followed_badge')}</div>
      <div class="card-followed-owner">${t('followed_owner_prefix')}${esc(c._owner_name)}</div>
    </div>`;
  }

  const visTag = c.is_public
    ? `<span class="card-visibility public">${t('visibility_public')}</span>`
    : `<span class="card-visibility private">${t('visibility_private')}</span>`;

  return `<div class="char-card" onclick="editChar('${id}')">
    ${c.illustration_url ? _cardIllus(c) : ''}
    <div class="card-actions">
      <button class="icon-btn" onclick="event.stopPropagation();editChar('${id}')"
        title="${t('btn_edit')}">
        ${_editIcon()}
      </button>
      <button class="icon-btn danger" onclick="event.stopPropagation();deleteCharFromDB('${id}')"
        title="${t('btn_delete')}">
        ${_trashIcon()}
      </button>
    </div>
    ${body}
    ${cardTags ? `<div class="card-tags">${cardTags}</div>` : ''}
    ${visTag}
  </div>`;
}

function editSharedFollowedChar(id) {
  if (!isUniverseGM()) { showSharedChar(followedChars[id]); return; }
  const shared = followedChars[id];
  if (!shared) return;
  unreadMarkers.markCharacterRead(id);
  unreadMarkers.refreshNavBadges({ followedChars, followedDocuments, followedChronicles, chrEntries });
  editChar(id, shared);
}

// Helpers HTML internes
function _cardIllus(c) {
  return `<img class="card-illus"
    src="${esc(c.illustration_url)}"
    style="object-position:center ${c.illustration_position || 0}%"
    onclick="event.stopPropagation();openLightbox('${esc(c.illustration_url)}')" alt="">`;
}
function _buildTagChips(id, tagMap) {
  return (tagMap[id] || []).map(tid => {
    const tg = allTags.find(x => x.id === tid);
    return tg
      ? `<span class="tag-chip" style="background:${tg.color}22;color:${tg.color};border:1px solid ${tg.color}44">${esc(tg.name)}</span>`
      : '';
  }).join('');
}
function _editIcon() {
  return `<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M11 2l3 3-9 9H2v-3z"/></svg>`;
}
function _trashIcon() {
  return `<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5"><polyline points="3,4 13,4"/><path d="M5 4V2h6v2M6 7v5M10 7v5"/><path d="M4 4l1 10h6l1-10"/></svg>`;
}

// ══════════════════════════════════════════════════════════════
// VUE PARTAGÉE (personnage suivi en lecture seule)
// ══════════════════════════════════════════════════════════════

function showSharedChar(data) {
  const sharedCharacterId = data?._db_id || null;
  if (sharedCharacterId) unreadMarkers.markCharacterRead(sharedCharacterId);
  document.getElementById('shared-content').innerHTML = `
    <div class="shared-banner">
      <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5">
        <circle cx="12" cy="3" r="1.5"/><circle cx="4" cy="8" r="1.5"/><circle cx="12" cy="13" r="1.5"/>
        <line x1="5.5" y1="7" x2="10.5" y2="4.3"/>
        <line x1="5.5" y1="9" x2="10.5" y2="11.7"/>
      </svg>
      ${t('shared_view_banner')}
    </div>
    ${renderCharSheet(data)}
    ${sharedCharacterId ? renderSecretNoteBlock(sharedCharacterId) : ''}
  `;
  showView('shared');
  unreadMarkers.refreshNavBadges({ followedChars, followedDocuments, followedChronicles, chrEntries });
  if (sharedCharacterId) setHash('char', sharedCharacterId);
  if (sharedCharacterId) _fillSecretNoteBlock(sharedCharacterId);
}

// ── Bloc note secrète réutilisable (vue partagée) ──────────────
let _secretNoteDraft = '';

function renderSecretNoteBlock(charId) {
  return `
    <div class="preview-section-title">🔒 ${t('section_secret')}</div>
    <div class="background-field">
      <textarea id="secret-note-textarea"
        placeholder="${esc(t('editor_secret_ph'))}"
        oninput="_secretNoteDraft=this.value"></textarea>
    </div>
    <div class="section-hint">${t('editor_secret_hint')}</div>
    <button class="btn-save" style="margin-top:10px;flex:none" onclick="saveSecretNoteFromBlock('${charId}')">
      ${t('btn_save')}
    </button>
  `;
}

async function _fillSecretNoteBlock(charId) {
  const content = await loadCharSecret(charId);
  _secretNoteDraft = content;
  const ta = document.getElementById('secret-note-textarea');
  if (ta) ta.value = content;
}

async function saveSecretNoteFromBlock(charId) {
  await saveCharSecretToDB(charId, _secretNoteDraft);
}

// ══════════════════════════════════════════════════════════════
// ILLUSTRATION & STORAGE
// ══════════════════════════════════════════════════════════════

function illusZoneClick() {
  if (!state.illustration_url) document.getElementById('illus-input').click();
}

function setIllusPreview(url, position) {
  const img         = document.getElementById('illus-preview-img');
  const placeholder = document.getElementById('illus-placeholder');
  const zone        = document.getElementById('illus-zone');
  const sliderWrap  = document.getElementById('illus-slider-wrap');
  const slider      = document.getElementById('illus-pos-slider');
  const pos = position !== undefined ? position : (state.illustration_position || 0);
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

function updateIllusPosition(val) {
  state.illustration_position = parseInt(val);
  const img = document.getElementById('illus-preview-img');
  if (img) img.style.objectPosition = `center ${val}%`;
  const previewImg = document.querySelector('#preview-content .preview-illus');
  if (previewImg) previewImg.style.objectPosition = `center ${val}%`;
}

function compressImage(file) {
  return new Promise((resolve) => {
    const MAX    = 1200;
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
        canvas.toBlob(resolve, 'image/jpeg', 0.75);
      };
      img.src = e.target.result;
    };
    reader.readAsDataURL(file);
  });
}

async function uploadIllustration(input) {
  const file = input.files[0];
  if (!file) return;
  if (file.size > 3 * 1024 * 1024) { showToast(t('toast_illus_too_large')); return; }
  document.getElementById('illus-uploading').classList.add('active');
  const oldUrl = state.illustration_url || '';
  const path   = `${currentUser.id}/${editingId || ('tmp_' + Date.now())}.jpg`;
  const blob   = await compressImage(file);
  const { error } = await sb.storage
    .from('character-illustrations').upload(path, blob, { upsert: true, contentType: 'image/jpeg' });
  document.getElementById('illus-uploading').classList.remove('active');
  if (error) { showToast(t('toast_illus_upload_error') + error.message); return; }
  if (oldUrl && !oldUrl.includes(path)) await deleteStorageFile(oldUrl);
  const { data } = sb.storage.from('character-illustrations').getPublicUrl(path);
  state.illustration_url      = `${data.publicUrl}?v=${Date.now()}`;
  state.illustration_position = 0;
  setIllusPreview(state.illustration_url, 0);
  updatePreview();
  showToast(t('toast_illus_added'));
  input.value = '';
}

async function deleteStorageFile(url) {
  if (!url) return;
  const match = url.match(/character-illustrations\/([^?#]+)/);
  if (match) await sb.storage.from('character-illustrations').remove([match[1]]);
}

async function removeIllustration() {
  if (!state.illustration_url) return;
  await deleteStorageFile(state.illustration_url);
  state.illustration_url      = '';
  state.illustration_position = 0;
  setIllusPreview('', 0);
  updatePreview();
}

function openLightbox(url) {
  document.getElementById('lightbox-img').src = url;
  document.getElementById('lightbox').classList.add('open');
}
function closeLightbox() {
  document.getElementById('lightbox').classList.remove('open');
}
document.addEventListener('keydown', e => { if (e.key === 'Escape') closeLightbox(); });

// ══════════════════════════════════════════════════════════════
// UTILS
// ══════════════════════════════════════════════════════════════

function setSaveIndicator(st, msg) {
  const el = document.getElementById('save-indicator');
  el.textContent = msg;
  el.className   = `save-indicator show ${st}`;
  if (st === 'saved') setTimeout(() => el.classList.remove('show'), 3000);
}

function showToast(msg) {
  const toast = document.getElementById('toast');
  toast.textContent = msg;
  toast.classList.add('show');
  setTimeout(() => toast.classList.remove('show'), 2800);
}

function esc(s) {
  if (!s) return '';
  return String(s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}


function normalizeMarkdownTypography(text) {
  if (!text) return '';
  return String(text).replace(/(^|[\s\(\[{"'])--(?=\s|$|[\)\]}",.!?:;])/g, '$1—');
}

function normalizeMarkdownTextarea(textarea) {
  if (!textarea) return '';
  const start = textarea.selectionStart;
  const end = textarea.selectionEnd;
  const normalized = normalizeMarkdownTypography(textarea.value);
  if (normalized !== textarea.value) {
    textarea.value = normalized;
    const nextStart = Math.max(0, start - 1);
    const nextEnd = Math.max(0, end - 1);
    textarea.setSelectionRange(nextStart, nextEnd);
  }
  return textarea.value;
}

function renderMarkdown(md) {
  return marked.parse(normalizeMarkdownTypography(md || ''));
}

function pipRow(val, cls, max) {
  return Array.from({ length: max }, (_, i) =>
    `<div class="pip ${i < val ? cls : 'empty'}"></div>`
  ).join('');
}

// ══════════════════════════════════════════════════════════════
// ROUTAGE PAR URL (hash)
// Format : #char/CODE | #chr/CODE | #entry/CHR_CODE/ENTRY_ID
//          #doc/CODE  | #campaign/CODE
// ══════════════════════════════════════════════════════════════

function setHash(type, ...ids) {
  history.replaceState(null, '', `#${type}/${ids.join('/')}`);
}

function clearHash() {
  history.replaceState(null, '', window.location.pathname + window.location.search);
}

function navigateFromHash() {
  const hash = window.location.hash.slice(1);
  if (!hash) return false;
  const [type, ...ids] = hash.split('/');
  switch (type) {
    case 'char':     return navigateToChar(ids[0]);
    case 'chr':      return navigateToChr(ids[0]);
    case 'entry':    return navigateToEntry(ids[0], ids[1]);
    case 'doc':      return navigateToDoc(ids[0]);
    case 'campaign': return navigateToCampaign(ids[0]);
    default:         return false;
  }
}

function navigateToChar(id) {
  if (!id) return false;
  if (chars[id])         { editChar(id); return true; }
  if (followedChars[id]) { showSharedChar(followedChars[id]); return true; }
  sb.from('characters')
    .select('id, name, rank, is_public, data, user_id')
    .eq('id', id).eq('universe_id', currentUniverse.id).single()
    .then(async ({ data: row, error }) => {
      if (error || !row) { showToast(t('toast_char_not_found')); showView('list'); renderList(); return; }
      const { data: profile } = await sb.from('profiles').select('username').eq('id', row.user_id).single();
      const charData = {
        ...row.data, name: row.name, rank: row.rank,
        is_public: row.is_public, _db_id: row.id, _owner_id: row.user_id, _owner_name: profile?.username || '?',
      };
      showSharedChar(charData);
    });
  return true;
}

function navigateToChr(id) {
  if (!id) return false;
  if (chronicles[id])         { showChrDetail(id); return true; }
  if (followedChronicles[id]) { showChrDetail(id); return true; }
  sb.from('chronicles')
    .select('id, title, description, is_public, illustration_url, illustration_position, updated_at, user_id')
    .eq('id', id).eq('universe_id', currentUniverse.id).single()
    .then(async ({ data: row, error }) => {
      if (error || !row) { showToast(t('toast_chr_not_found')); showView('chronicles'); return; }
      const { data: profile } = await sb.from('profiles').select('username').eq('id', row.user_id).single();
      followedChronicles[row.id] = { ...row, _followed: true, _owner_name: profile?.username || '?', entry_count: 0 };
      showChrDetail(row.id);
    });
  return true;
}

function navigateToEntry(chrId, entryId) {
  if (!chrId || !entryId) return false;
  const resolveChrId = () => (chronicles[chrId] || followedChronicles[chrId]) ? chrId : null;
  const openEntry = (id) => {
    activeChrId = id;
    loadEntriesForChronicle(id).then(() => {
      const entry = (chrEntries[id] || []).find(e => e.id === entryId);
      if (!entry) { showToast(t('toast_entry_not_found')); showView('chronicles'); return; }
      openEntryReader(entryId);
    });
  };
  const resolved = resolveChrId();
  if (resolved) { openEntry(resolved); return true; }
  navigateToChr(chrId);
  const wait = setInterval(() => {
    const r = resolveChrId();
    if (r) { clearInterval(wait); openEntry(r); }
  }, 100);
  setTimeout(() => clearInterval(wait), 5000);
  return true;
}

function navigateToDoc(id) {
  if (!id) return false;
  if (documents[id])         { openDocReader(id); return true; }
  if (followedDocuments[id]) { openDocReader(id); return true; }
  sb.from('documents')
    .select('id, title, content, is_public, illustration_url, illustration_position, updated_at, user_id')
    .eq('id', id).eq('universe_id', currentUniverse.id).single()
    .then(async ({ data: row, error }) => {
      if (error || !row) { showToast(t('toast_doc_not_found')); showView('documents'); return; }
      const { data: profile } = await sb.from('profiles').select('username').eq('id', row.user_id).single();
      followedDocuments[row.id] = { ...row, _followed: true, _owner_name: profile?.username || '?' };
      openDocReader(row.id);
    });
  return true;
}

function navigateToCampaign(id) {
  if (!id || !campaigns[id]) return false;
  showCampaignDetail(id);
  return true;
}

/**
 * Appelle sync_owner_tags via RPC.
 * p_item_id est passé en string (TEXT) pour éviter le cast UUID
 * que PostgREST ne sait pas faire automatiquement depuis le JSON.
 */
async function syncOwnerTagsToMe(type, itemId) {
  try {
    const { error } = await sb.rpc('sync_owner_tags', {
      p_item_type: type,
      p_item_id:   String(itemId),   // ← TEXT, pas UUID
    });
    if (error) console.warn('syncOwnerTagsToMe:', error.message);
  } catch (err) {
    console.warn('syncOwnerTagsToMe: non-fatal error', err);
  }
}
 
/**
 * Appelle cleanup_orphan_char_tags ou cleanup_orphan_doc_tags.
 * À appeler après un désabonnement ou la suppression d'un tag local.
 */
async function cleanupOrphanTags(type) {
  try {
    const fn = type === 'doc' ? 'cleanup_orphan_doc_tags' : 'cleanup_orphan_char_tags';
    await sb.rpc(fn, { p_user_id: currentUser.id });
  } catch (err) {
    console.warn('cleanupOrphanTags: non-fatal error', err);
  }
}

// ── Boot ──────────────────────────────────────────────────────
document.getElementById('app').style.display = 'none';
document.getElementById('universe-screen')?.classList.remove('active');
window.bootCamplyApp = init;
init();
