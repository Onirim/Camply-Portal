(function(){
  const state = {
    userId: null,
    universeId: null,
    loaded: false,
    characters: {},
    documents: {},
    chronicles: {},
    chronicle_entries: {}
  };

  function resetLocalState() {
    state.loaded = false;
    state.characters = {};
    state.documents = {};
    state.chronicles = {};
    state.chronicle_entries = {};
  }

  function ensureChronicleMap(chrId) {
    if (!state.chronicle_entries[chrId]) state.chronicle_entries[chrId] = {};
    return state.chronicle_entries[chrId];
  }

  async function initFromDB(userId, universeId) {
    state.userId = userId || null;
    state.universeId = universeId || null;
    resetLocalState();
    if (!state.userId || !state.universeId) return;

    const { data, error } = await sb
      .from('read_markers')
      .select('content_type, content_id, parent_id')
      .eq('user_id', state.userId)
      .eq('universe_id', state.universeId);

    if (error) {
      console.error('Erreur chargement read_markers:', error);
      return;
    }

    (data || []).forEach(row => {
      if (row.content_type === 'character') {
        state.characters[row.content_id] = true;
      } else if (row.content_type === 'document') {
        state.documents[row.content_id] = true;
      } else if (row.content_type === 'chronicle') {
        state.chronicles[row.content_id] = true;
      } else if (row.content_type === 'chronicle_entry' && row.parent_id) {
        ensureChronicleMap(row.parent_id)[row.content_id] = true;
      }
    });

    state.loaded = true;
  }

  async function upsertReadMarker(contentType, contentId, parentId = null) {
    if (!state.userId || !state.universeId || !contentType || !contentId) return;
    const { error } = await sb
      .from('read_markers')
      .upsert({
        user_id: state.userId,
        universe_id: state.universeId,
        content_type: contentType,
        content_id: contentId,
        parent_id: parentId,
        read_at: new Date().toISOString()
      }, { onConflict: 'universe_id,user_id,content_type,content_id' });

    if (error) console.error('Erreur sauvegarde read_marker:', error);
  }

  function markRead(bucket, id, dbType, parentId = null) {
    if (!id) return;
    state[bucket][id] = true;
    upsertReadMarker(dbType, id, parentId);
  }

  function isUnread(bucket, id, isOwn) {
    if (isOwn || !id) return false;
    return !state[bucket][id];
  }

  function markEntryRead(chrId, entryId) {
    if (!chrId || !entryId) return;
    ensureChronicleMap(chrId)[entryId] = true;
    upsertReadMarker('chronicle_entry', entryId, chrId);
  }

  function isEntryUnread(chrId, entryId, isOwn) {
    if (isOwn || !chrId || !entryId) return false;
    return !ensureChronicleMap(chrId)[entryId];
  }

  function syncChronicleEntries(chrId, entryIds) {
    if (!chrId || !Array.isArray(entryIds)) return;
    const known = ensureChronicleMap(chrId);
    const keep = new Set(entryIds);
    Object.keys(known).forEach(id => {
      if (!keep.has(id)) delete known[id];
    });
  }

  function chronicleHasUnreadEntries(chrId, entryIds, isOwn) {
    if (isOwn || !chrId || !Array.isArray(entryIds) || !entryIds.length) return false;
    const readMap = ensureChronicleMap(chrId);
    return entryIds.some(id => !readMap[id]);
  }

  function cardDotHTML(show) {
    return show ? '<span class="unread-dot unread-dot-card" aria-hidden="true"></span>' : '';
  }

  function entryDotHTML(show) {
    return show ? '<span class="unread-dot unread-dot-entry" aria-hidden="true"></span>' : '';
  }

  function setNavDot(navId, show) {
    const btn = document.getElementById(navId);
    if (!btn) return;
    let dot = btn.querySelector('.nav-unread-dot');
    if (show && !dot) {
      dot = document.createElement('span');
      dot.className = 'nav-unread-dot';
      dot.setAttribute('aria-hidden', 'true');
      btn.appendChild(dot);
    }
    if (!show && dot) dot.remove();
  }

  async function markAllRead() {
    if (!state.userId || !state.universeId) return false;

    const [charsRes, docsRes, chrRes] = await Promise.all([
      sb.from('characters').select('id').eq('universe_id', state.universeId).neq('user_id', state.userId),
      sb.from('documents').select('id').eq('universe_id', state.universeId).neq('user_id', state.userId),
      sb.from('chronicles').select('id').eq('universe_id', state.universeId).neq('user_id', state.userId)
    ]);
    if (charsRes.error || docsRes.error || chrRes.error) {
      console.error('Erreur lecture contenu univers:', charsRes.error || docsRes.error || chrRes.error);
      return false;
    }

    const charIds = (charsRes.data || []).map(r => r.id);
    const docIds = (docsRes.data || []).map(r => r.id);
    const chrIds = (chrRes.data || []).map(r => r.id);

    let entryRows = [];
    if (chrIds.length) {
      const { data: entries, error: entriesError } = await sb
        .from('chronicle_entries')
        .select('id, chronicle_id')
        .in('chronicle_id', chrIds);
      if (entriesError) { console.error('Erreur lecture entrées:', entriesError); return false; }
      entryRows = entries || [];
    }

    const now = new Date().toISOString();
    const rows = [
      ...charIds.map(id => ({ user_id: state.userId, universe_id: state.universeId, content_type: 'character', content_id: id, parent_id: null, read_at: now })),
      ...docIds.map(id => ({ user_id: state.userId, universe_id: state.universeId, content_type: 'document', content_id: id, parent_id: null, read_at: now })),
      ...chrIds.map(id => ({ user_id: state.userId, universe_id: state.universeId, content_type: 'chronicle', content_id: id, parent_id: null, read_at: now })),
      ...entryRows.map(e => ({ user_id: state.userId, universe_id: state.universeId, content_type: 'chronicle_entry', content_id: e.id, parent_id: e.chronicle_id, read_at: now })),
    ];

    if (rows.length) {
      const { error } = await sb
        .from('read_markers')
        .upsert(rows, { onConflict: 'universe_id,user_id,content_type,content_id' });
      if (error) { console.error('Erreur marquage global lu:', error); return false; }
    }

    charIds.forEach(id => { state.characters[id] = true; });
    docIds.forEach(id => { state.documents[id] = true; });
    chrIds.forEach(id => { state.chronicles[id] = true; });
    entryRows.forEach(e => { ensureChronicleMap(e.chronicle_id)[e.id] = true; });

    return true;
  }

  function refreshNavBadges(ctx = {}) {
    const followedChars = ctx.followedChars || {};
    const followedDocuments = ctx.followedDocuments || {};
    const followedChronicles = ctx.followedChronicles || {};
    const chrEntries = ctx.chrEntries || {};

    const hasUnreadChars = Object.keys(followedChars).some(id => isUnread('characters', id, false));
    const hasUnreadDocs = Object.keys(followedDocuments).some(id => isUnread('documents', id, false));

    const hasUnreadChronicles = Object.keys(followedChronicles).some(chrId => {
      if (isUnread('chronicles', chrId, false)) return true;
      const entries = chrEntries[chrId] || [];
      return chronicleHasUnreadEntries(chrId, entries.map(e => e.id), false);
    });

    setNavDot('nav-list', hasUnreadChars);
    setNavDot('nav-documents', hasUnreadDocs);
    setNavDot('nav-chronicles', hasUnreadChronicles);
  }

  window.unreadMarkers = {
    initFromDB,
    resetCache: resetLocalState,
    markAllRead,
    isCharacterUnread: (id, isOwn) => isUnread('characters', id, isOwn),
    markCharacterRead: (id) => markRead('characters', id, 'character'),
    isDocumentUnread: (id, isOwn) => isUnread('documents', id, isOwn),
    markDocumentRead: (id) => markRead('documents', id, 'document'),
    isChronicleUnread: (id, isOwn) => isUnread('chronicles', id, isOwn),
    markChronicleRead: (id) => markRead('chronicles', id, 'chronicle'),
    isEntryUnread,
    markEntryRead,
    syncChronicleEntries,
    chronicleHasUnreadEntries,
    cardDotHTML,
    entryDotHTML,
    refreshNavBadges
  };
})();
