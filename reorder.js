// ══════════════════════════════════════════════════════════════
// Camply TTRPG Manager — Réorganisation des entrées de fiche
// (caractéristiques, compétences, traits)
//
// Un bouton ⇅ par section bascule en mode réorganisation :
// les entrées sont rendues en version compacte, déplaçables par
// glisser-déposer (poignée, Pointer Events) ou par flèches ↑/↓.
// L'ordre vit dans state.<section> : il est sauvegardé avec la
// fiche comme n'importe quelle autre modification.
// ══════════════════════════════════════════════════════════════

const reorderMode = { characteristics: false, skills: false, traits: false };

const REORDER_RENDERERS = {
  characteristics: () => renderCharacteristics(),
  skills:          () => renderSkills(),
  traits:          () => renderTraits(),
};

const REORDER_NAME_PH = {
  characteristics: 'editor_char_name_ph',
  skills:          'editor_skill_name_ph',
  traits:          'editor_trait_name_ph',
};

function toggleReorder(section) {
  reorderMode[section] = !reorderMode[section];
  syncReorderUI(section);
  REORDER_RENDERERS[section]();
}

// Réinitialise le mode pour toutes les sections (ouverture d'un
// personnage, changement de fiche…)
function resetReorderModes() {
  Object.keys(reorderMode).forEach(section => {
    reorderMode[section] = false;
    syncReorderUI(section);
  });
}

// État visuel : bouton ⇅ actif + bouton "+ Ajouter" masqué
function syncReorderUI(section) {
  const active = reorderMode[section];
  const btn = document.getElementById(`reorder-btn-${section}`);
  if (btn) btn.classList.toggle('active', active);
  const wrap = document.getElementById(`section-${section}-wrap`);
  const addBtn = wrap?.querySelector('.add-btn');
  if (addBtn) addBtn.style.display = active ? 'none' : '';
}


// ══════════════════════════════════════════════════════════════
// RENDU COMPACT
// ══════════════════════════════════════════════════════════════

function reorderEntryHTML(section, item, i) {
  const total = (state[section] || []).length;
  const name = item.name
    ? esc(item.name)
    : `<span class="reorder-name-empty">${t(REORDER_NAME_PH[section])}</span>`;
  const hasScore = item.score !== '' && item.score !== undefined && item.score !== null;
  const scoreHtml = hasScore ? `<span class="reorder-score">${item.score}</span>` : '';
  const borderStyle = section === 'traits'
    ? ` style="border-left:3px solid ${esc(item.color || 'var(--border2)')}"` : '';

  return `<div class="generic-entry reorder-entry" data-idx="${i}"${borderStyle}>
    <button class="reorder-grip" onpointerdown="startEntryDrag(event,'${section}')">
      <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5">
        <line x1="3" y1="4.5"  x2="13" y2="4.5"/>
        <line x1="3" y1="8"    x2="13" y2="8"/>
        <line x1="3" y1="11.5" x2="13" y2="11.5"/>
      </svg>
    </button>
    <span class="reorder-name">${name}</span>
    ${scoreHtml}
    <div class="reorder-arrows">
      <button onclick="moveEntry('${section}',${i},-1)" ${i === 0 ? 'disabled' : ''}>
        <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5">
          <polyline points="4,10 8,5 12,10"/>
        </svg>
      </button>
      <button onclick="moveEntry('${section}',${i},1)" ${i === total - 1 ? 'disabled' : ''}>
        <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5">
          <polyline points="4,6 8,11 12,6"/>
        </svg>
      </button>
    </div>
  </div>`;
}


// ══════════════════════════════════════════════════════════════
// DÉPLACEMENT PAR FLÈCHES
// ══════════════════════════════════════════════════════════════

function moveEntry(section, i, delta) {
  const arr = state[section];
  const j = i + delta;
  if (!arr || j < 0 || j >= arr.length) return;
  [arr[i], arr[j]] = [arr[j], arr[i]];
  REORDER_RENDERERS[section]();
  updatePreview();
}


// ══════════════════════════════════════════════════════════════
// GLISSER-DÉPOSER (Pointer Events — souris + tactile)
// Le drag ne déplace que des nœuds DOM ; le tableau n'est
// réordonné qu'au relâchement, d'après l'ordre final des nœuds.
// ══════════════════════════════════════════════════════════════

function startEntryDrag(e, section) {
  e.preventDefault();
  const handle = e.currentTarget;
  const entry  = handle.closest('.reorder-entry');
  const list   = entry?.parentElement;
  if (!entry || !list) return;

  const rect    = entry.getBoundingClientRect();
  const offsetY = e.clientY - rect.top;   // décalage curseur → haut de l'entrée

  // Emplacement fantôme : conserve la place dans le flux pendant que
  // l'entrée passe en position flottante et suit le curseur.
  const placeholder = document.createElement('div');
  placeholder.className = 'reorder-placeholder';
  placeholder.style.height = rect.height + 'px';
  list.insertBefore(placeholder, entry.nextSibling);

  entry.classList.add('dragging');
  entry.style.width    = rect.width + 'px';
  entry.style.position = 'fixed';
  entry.style.left     = rect.left + 'px';
  entry.style.top      = rect.top + 'px';

  // Capture du pointeur : les événements suivants sont routés vers la
  // poignée puis remontent jusqu'à window (où l'on écoute), même si le
  // curseur sort de la poignée.
  try { handle.setPointerCapture(e.pointerId); } catch (_) {}

  const onMove = ev => {
    entry.style.top = (ev.clientY - offsetY) + 'px';

    // Repositionne le fantôme selon le milieu des autres entrées.
    const sibs = Array.from(list.children).filter(c => c !== entry && c !== placeholder);
    let placed = false;
    for (const sib of sibs) {
      const r = sib.getBoundingClientRect();
      if (ev.clientY < r.top + r.height / 2) {
        list.insertBefore(placeholder, sib);
        placed = true;
        break;
      }
    }
    if (!placed) list.appendChild(placeholder);
  };

  const onUp = () => {
    window.removeEventListener('pointermove', onMove);
    window.removeEventListener('pointerup', onUp);
    window.removeEventListener('pointercancel', onUp);
    try { handle.releasePointerCapture(e.pointerId); } catch (_) {}
    list.insertBefore(entry, placeholder);   // l'entrée reprend la place du fantôme
    placeholder.remove();
    entry.classList.remove('dragging');
    entry.removeAttribute('style');
    commitReorderFromDom(section, list);
  };

  window.addEventListener('pointermove', onMove);
  window.addEventListener('pointerup', onUp);
  window.addEventListener('pointercancel', onUp);
}

function commitReorderFromDom(section, list) {
  const arr = state[section];
  if (!arr) return;
  const order = Array.from(list.children).map(el => parseInt(el.dataset.idx, 10));
  state[section] = order.map(idx => arr[idx]);
  REORDER_RENDERERS[section]();
  updatePreview();
}
