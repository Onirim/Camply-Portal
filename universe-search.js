// ══════════════════════════════════════════════════════════════
// Camply TTRPG Manager — Recherche full-text dans l'univers
//
// Modale de recherche globale (loupe topbar + Ctrl/Cmd+K). Interroge
// la RPC Supabase `search_universe(universe, query)` qui renvoie les
// éléments de l'univers courant contenant les mots cherchés
// (personnages, chroniques, entrées, documents, marqueurs de carte),
// puis délègue la navigation aux fonctions navigateToXxx() existantes.
// ══════════════════════════════════════════════════════════════

// ── État ──────────────────────────────────────────────────────
let _usDebounce = null;   // timer de debounce sur la saisie
let _usSeq      = 0;      // n° de requête (ignore les réponses périmées)
let _usResults  = [];     // liste à plat, dans l'ordre visuel (nav clavier)
let _usSelected = -1;     // index sélectionné au clavier

// Ordre d'affichage des groupes + métadonnées par type.
const _US_KINDS = ['char', 'chr', 'entry', 'doc', 'marker'];
const _US_META = {
  char:   { groupKey: 'search_group_characters', icon: '<circle cx="8" cy="5" r="3"/><path d="M2.5 14a5.5 5.5 0 0 1 11 0"/>' },
  chr:    { groupKey: 'search_group_chronicles', icon: '<path d="M3 2h8l2 2v10H3z"/><path d="M6 6h5M6 9h5"/>' },
  entry:  { groupKey: 'search_group_entries',    icon: '<path d="M4 2h6l2 2v10H4z"/><path d="M6 6h4M6 9h4M6 12h2"/>' },
  doc:    { groupKey: 'search_group_documents',  icon: '<path d="M4 2h5l3 3v9H4z"/><path d="M9 2v3h3"/>' },
  marker: { groupKey: 'search_group_markers',    icon: '<path d="M8 1.5c-2.5 0-4.5 2-4.5 4.5C3.5 9.5 8 14.5 8 14.5s4.5-5 4.5-8.5C12.5 3.5 10.5 1.5 8 1.5z"/><circle cx="8" cy="6" r="1.6"/>' },
};

// ── Ouverture / fermeture ─────────────────────────────────────
function openUniverseSearch() {
  if (!currentUniverse) return;   // recherche uniquement dans un univers
  const modal = document.getElementById('universe-search-modal');
  const input = document.getElementById('universe-search-input');
  if (!modal || !input) return;
  modal.classList.add('open');
  input.value = '';
  _usResults  = [];
  _usSelected = -1;
  _renderUniverseSearchState('idle');
  // Focus après le paint pour éviter que le clavier mobile ne saute.
  requestAnimationFrame(() => input.focus());
}

function closeUniverseSearch() {
  const modal = document.getElementById('universe-search-modal');
  if (modal) modal.classList.remove('open');
  if (_usDebounce) { clearTimeout(_usDebounce); _usDebounce = null; }
  _usResults  = [];
  _usSelected = -1;
}

function isUniverseSearchOpen() {
  return document.getElementById('universe-search-modal')?.classList.contains('open');
}

// ── Saisie (debounced) ────────────────────────────────────────
function onUniverseSearchInput(value) {
  if (_usDebounce) clearTimeout(_usDebounce);
  const q = (value || '').trim();
  if (q.length < 2) {
    _usResults = []; _usSelected = -1;
    _renderUniverseSearchState(q.length ? 'tooShort' : 'idle');
    return;
  }
  _renderUniverseSearchState('loading');
  _usDebounce = setTimeout(() => _runUniverseSearch(q), 250);
}

async function _runUniverseSearch(query) {
  const seq = ++_usSeq;
  const { data, error } = await sb.rpc('search_universe', {
    p_universe_id: currentUniverse.id,
    p_query:       query,
  });
  if (seq !== _usSeq || !isUniverseSearchOpen()) return;   // réponse périmée
  if (error) {
    console.warn('search_universe:', error);
    _renderUniverseSearchState('error');
    return;
  }
  _renderUniverseSearchResults(data || []);
}

// ── Rendu ─────────────────────────────────────────────────────
function _renderUniverseSearchState(kind) {
  const box = document.getElementById('universe-search-results');
  if (!box) return;
  const msgKey = {
    idle:     'search_hint_type',
    tooShort: 'search_hint_type',
    loading:  'search_loading',
    error:    'search_error',
  }[kind];
  box.innerHTML = `<div class="us-empty">${esc(t(msgKey))}</div>`;
}

function _renderUniverseSearchResults(rows) {
  const box = document.getElementById('universe-search-results');
  if (!box) return;

  if (!rows.length) {
    _usResults = []; _usSelected = -1;
    box.innerHTML = `<div class="us-empty">${esc(t('search_no_results'))}</div>`;
    return;
  }

  // Regroupe par type, dans l'ordre fixe des groupes, en conservant
  // l'ordre de pertinence renvoyé par la RPC à l'intérieur de chaque groupe.
  const byKind = {};
  rows.forEach(r => { (byKind[r.kind] ||= []).push(r); });

  _usResults = [];   // reconstruit la liste à plat (ordre visuel)
  let html = '';
  for (const kind of _US_KINDS) {
    const group = byKind[kind];
    if (!group || !group.length) continue;
    const meta = _US_META[kind];
    html += `<div class="us-group-title">${esc(t(meta.groupKey))}</div>`;
    for (const r of group) {
      const idx = _usResults.length;
      _usResults.push(r);
      html += `
        <div class="us-item" data-idx="${idx}" onclick="_activateSearchIndex(${idx})">
          <span class="us-item-icon"><svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4">${meta.icon}</svg></span>
          <span class="us-item-text">
            <span class="us-item-title">${esc(r.title) || esc(t('search_untitled'))}</span>
            ${r.snippet ? `<span class="us-item-snippet">${_usHighlight(r.snippet)}</span>` : ''}
          </span>
        </div>`;
    }
  }

  box.innerHTML = html;
  _usSelected = 0;
  _refreshSearchSelection();
}

// Transforme les jetons de surlignage renvoyés par ts_headline en <mark>,
// après échappement HTML du reste (protège contre du contenu malveillant).
function _usHighlight(snippet) {
  return esc(snippet)
    .replaceAll('@@HL@@', '<mark>')
    .replaceAll('@@/HL@@', '</mark>');
}

// ── Sélection clavier ─────────────────────────────────────────
function _moveSearchSelection(delta) {
  if (!_usResults.length) return;
  _usSelected = (_usSelected + delta + _usResults.length) % _usResults.length;
  _refreshSearchSelection();
}

function _refreshSearchSelection() {
  const box = document.getElementById('universe-search-results');
  if (!box) return;
  box.querySelectorAll('.us-item').forEach(el => {
    const on = Number(el.dataset.idx) === _usSelected;
    el.classList.toggle('selected', on);
    if (on) el.scrollIntoView({ block: 'nearest' });
  });
}

function _activateSearchIndex(idx) {
  const r = _usResults[idx];
  if (r) _goToSearchResult(r);
}

// ── Navigation vers le résultat ───────────────────────────────
function _goToSearchResult(r) {
  closeUniverseSearch();
  switch (r.kind) {
    case 'char':   navigateToChar(r.id); break;
    case 'chr':    navigateToChr(r.id); break;
    case 'entry':  navigateToEntry(r.parent_id, r.id); break;
    case 'doc':    navigateToDoc(r.id); break;
    case 'marker': navigateToMap(r.id); break;
  }
}

// ── Raccourcis clavier globaux ────────────────────────────────
document.addEventListener('keydown', e => {
  // Ctrl/Cmd+K : ouvrir (uniquement dans un univers, appli prête)
  if ((e.ctrlKey || e.metaKey) && (e.key === 'k' || e.key === 'K')) {
    if (!currentUniverse) return;
    e.preventDefault();
    isUniverseSearchOpen() ? closeUniverseSearch() : openUniverseSearch();
    return;
  }
  if (!isUniverseSearchOpen()) return;
  switch (e.key) {
    case 'Escape':    e.preventDefault(); closeUniverseSearch(); break;
    case 'ArrowDown': e.preventDefault(); _moveSearchSelection(1); break;
    case 'ArrowUp':   e.preventDefault(); _moveSearchSelection(-1); break;
    case 'Enter':
      if (_usSelected >= 0) { e.preventDefault(); _activateSearchIndex(_usSelected); }
      break;
  }
});
