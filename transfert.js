// ══════════════════════════════════════════════════════════════
// Camply — Module Transfert d'éléments
// ══════════════════════════════════════════════════════════════

// ── Constantes ───────────────────────────────────────────────

const TRANSFER_TYPES = () => [
  {
    value: 'char',
    label: t('transfer_type_char'),
    icon:  '👤',
    color: 'var(--accent)',
  },
  {
    value: 'chr',
    label: t('transfer_type_chr'),
    icon:  '📖',
    color: 'var(--sup)',
  },
  {
    value: 'doc',
    label: t('transfer_type_doc'),
    icon:  '📄',
    color: 'var(--def)',
  },
  {
    value: 'map',
    label: t('transfer_type_map'),
    icon:  '🗺️',
    color: 'var(--mov)',
  },
];

// Liste des objets possédés par l'utilisateur pour le type sélectionné.
function _ownItemsOfType(type) {
  if (type === 'char') return Object.values(chars).map(c => ({ id: c._db_id, name: c.name || '—' }));
  if (type === 'chr')  return Object.values(chronicles).map(c => ({ id: c.id, name: c.title || '—' }));
  if (type === 'doc')  return Object.values(documents).map(d => ({ id: d.id, name: d.title || '—' }));
  if (type === 'map')  return Object.values(mapOwnLayers || {}).map(l => ({ id: l.id, name: l.title || l.map_key || '—' }));
  return [];
}

const TRANSFER_ERRORS = () => ({
  not_authenticated:  t('transfer_error_not_auth'),
  user_not_found:     t('transfer_error_user_not_found'),
  same_user:          t('transfer_error_same_user'),
  item_not_found:     t('transfer_error_item_not_found'),
  not_owner:          t('transfer_error_not_owner'),
  invalid_type:       t('transfer_error_invalid_type'),
});

// ── État du module ────────────────────────────────────────────

let _transferSelectedType  = 'char';
let _transferModalJustOpen = false; // guard anti-fermeture immédiate

// ── Helper guard ─────────────────────────────────────────────
// À appeler chaque fois qu'on reconstruit le innerHTML du panneau,
// pour que l'événement click en cours ne referme pas la modale.
function _armTransferGuard() {
  _transferModalJustOpen = true;
  setTimeout(() => { _transferModalJustOpen = false; }, 0);
}

// ══════════════════════════════════════════════════════════════
// OUVERTURE / FERMETURE
// ══════════════════════════════════════════════════════════════

function openTransferModal() {
  _transferSelectedType = 'char';
  _renderTransferModal();

  document.getElementById('transfer-modal').style.display = 'flex';
  _armTransferGuard();
  toggleUserMenu(false);
}

function closeTransferModal() {
  document.getElementById('transfer-modal').style.display = 'none';
  _resetTransferForm();
}

// Ferme sur clic en dehors du panneau (avec guard)
document.addEventListener('click', e => {
  if (_transferModalJustOpen) return;

  const modal = document.getElementById('transfer-modal');
  const panel = document.getElementById('transfer-modal-panel');
  if (!modal || modal.style.display !== 'flex') return;
  if (!panel.contains(e.target)) {
    closeTransferModal();
  }
});

// ══════════════════════════════════════════════════════════════
// RENDU DE LA MODALE
// ══════════════════════════════════════════════════════════════

function _renderTransferModal() {
  const types = TRANSFER_TYPES();

  const typesHtml = types.map(tp => `
    <button
      class="transfer-type-btn ${_transferSelectedType === tp.value ? 'active' : ''}"
      style="${_transferSelectedType === tp.value ? `--tcolor:${tp.color}` : ''}"
      onclick="selectTransferType('${tp.value}')">
      <span class="transfer-type-icon">${tp.icon}</span>
      <span class="transfer-type-label">${tp.label}</span>
    </button>`).join('');

  const ownItems = _ownItemsOfType(_transferSelectedType);
  const optionsHtml = ownItems.length
    ? ownItems.map(it => `<option value="${it.id}">${esc(it.name)}</option>`).join('')
    : '';

  document.getElementById('transfer-modal-panel').innerHTML = `
    <div class="transfer-header">
      <div class="transfer-title">
        <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.5" width="18" height="18">
          <path d="M4 10h12M13 6l4 4-4 4"/>
          <path d="M3 6l-2 2 2 2" opacity="0.5"/>
        </svg>
        ${t('transfer_modal_title')}
      </div>
      <button class="transfer-close-btn" onclick="closeTransferModal()" title="${t('btn_cancel')}">✕</button>
    </div>

    <p class="transfer-desc">${t('transfer_modal_desc')}</p>

    <div class="transfer-section-label">${t('transfer_step1')}</div>
    <div class="transfer-type-grid">${typesHtml}</div>

    <div class="transfer-section-label">${t('transfer_step2')}</div>
    <div class="transfer-field-wrap">
      ${ownItems.length ? `
      <select
        id="transfer-item-select"
        class="transfer-code-input"
        onchange="_refreshTransferConfirmState()">
        <option value="">${t('transfer_item_select_ph')}</option>
        ${optionsHtml}
      </select>` : `
      <div class="transfer-item-preview not-found" style="display:flex">${t('transfer_item_none')}</div>`}
    </div>

    <div class="transfer-section-label">${t('transfer_step3')}</div>
    <div class="transfer-field-wrap">
      <div class="transfer-username-wrap">
        <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" width="14" height="14">
          <circle cx="8" cy="5" r="3"/>
          <path d="M2 14c0-3.3 2.7-6 6-6s6 2.7 6 6"/>
        </svg>
        <input
          type="text"
          id="transfer-username-input"
          class="transfer-username-input"
          placeholder="${t('transfer_username_ph')}"
          oninput="_refreshTransferConfirmState()"
          autocomplete="off"
          spellcheck="false">
      </div>
    </div>

    <div id="transfer-warning" class="transfer-warning" style="display:none">
      <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" width="14" height="14">
        <path d="M8 2L1 14h14L8 2z"/>
        <line x1="8" y1="7" x2="8" y2="10"/>
        <circle cx="8" cy="12.5" r="0.5" fill="currentColor"/>
      </svg>
      ${t('transfer_warning_irreversible')}
    </div>

    <div id="transfer-error-msg" class="transfer-error-msg" style="display:none"></div>

    <div class="transfer-actions">
      <button class="btn-cancel" onclick="closeTransferModal()">${t('btn_cancel')}</button>
      <button class="transfer-confirm-btn" id="transfer-confirm-btn" onclick="confirmTransfer()" disabled>
        <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2" width="13" height="13">
          <path d="M4 10h8M9 6l4 4-4 4"/>
        </svg>
        ${t('transfer_btn_confirm')}
      </button>
    </div>
  `;

  _refreshTransferConfirmState();
}

// ══════════════════════════════════════════════════════════════
// INTERACTIONS
// ══════════════════════════════════════════════════════════════

function selectTransferType(type) {
  _transferSelectedType = type;
  // Le innerHTML du panneau va être reconstruit : le nœud cible de
  // l'événement click en cours sera détaché du DOM juste après.
  // On arme le guard AVANT le render pour que le listener de
  // fermeture ignore cet événement.
  _armTransferGuard();
  _renderTransferModal();
  requestAnimationFrame(() => {
    document.getElementById('transfer-item-select')?.focus();
  });
}

function _refreshTransferConfirmState() {
  const itemSelect = document.getElementById('transfer-item-select');
  const userInput  = document.getElementById('transfer-username-input');
  const confirmBtn = document.getElementById('transfer-confirm-btn');
  const warning    = document.getElementById('transfer-warning');
  if (!confirmBtn) return;

  const itemOk = !!itemSelect?.value;
  const userOk = (userInput?.value.trim().length ?? 0) > 0;
  const ready  = itemOk && userOk;

  confirmBtn.disabled = !ready;
  if (warning) warning.style.display = ready ? 'flex' : 'none';
}

function _clearTransferError() {
  const err = document.getElementById('transfer-error-msg');
  if (err) err.style.display = 'none';
}

function _showTransferError(msg) {
  const err = document.getElementById('transfer-error-msg');
  if (!err) return;
  err.textContent = msg;
  err.style.display = 'flex';
}

function _resetTransferForm() {
  _transferSelectedType = 'char';
}

// ══════════════════════════════════════════════════════════════
// CONFIRMATION ET APPEL RPC
// ══════════════════════════════════════════════════════════════

async function confirmTransfer() {
  const itemSelect = document.getElementById('transfer-item-select');
  const userInput  = document.getElementById('transfer-username-input');
  const confirmBtn = document.getElementById('transfer-confirm-btn');

  if (!itemSelect || !userInput) return;

  const itemId   = itemSelect.value;
  const username = userInput.value.trim();

  if (!itemId || !username) return;

  _clearTransferError();
  confirmBtn.disabled = true;
  confirmBtn.innerHTML = `
    <div class="spinner" style="width:14px;height:14px;border-width:2px"></div>
    ${t('transfer_btn_in_progress')}`;

  try {
    const { data, error } = await sb.rpc('transfer_item', {
      p_item_type:   _transferSelectedType,
      p_item_id:     itemId,
      p_to_username: username,
    });

    if (error) {
      _showTransferError(t('transfer_error_network') + ' ' + error.message);
      _restoreConfirmBtn();
      return;
    }

    if (!data?.ok) {
      const errMap = TRANSFER_ERRORS();
      const msg = errMap[data?.error] || t('transfer_error_unknown');
      _showTransferError(msg);
      _restoreConfirmBtn();
      return;
    }



    closeTransferModal();
    await _reloadAllDataAfterTransfer();
    showToast(t('transfer_success'));



  } catch (err) {
    _showTransferError(t('transfer_error_network') + ' ' + err.message);
    _restoreConfirmBtn();
  }
}

function _restoreConfirmBtn() {
  const btn = document.getElementById('transfer-confirm-btn');
  if (!btn) return;
  btn.disabled = false;
  btn.innerHTML = `
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2" width="13" height="13">
      <path d="M4 10h8M9 6l4 4-4 4"/>
    </svg>
    ${t('transfer_btn_confirm')}`;
}

function _removeFromLocalStores(type, itemId) {
  if (type === 'char') {
    delete chars[itemId]; delete charTagMap[itemId];
  } else if (type === 'chr') {
    delete chronicles[itemId]; delete chrEntries[itemId];
  } else if (type === 'doc') {
    delete documents[itemId]; delete docTagMap[itemId];
  } else if (type === 'map') {
    const key = Object.keys(mapOwnLayers || {}).find(k => mapOwnLayers[k].id === itemId);
    if (key) delete mapOwnLayers[key];
  }
}

async function _reloadAllDataAfterTransfer() {
  await Promise.all([
    (typeof loadCharsFromDB === 'function' ? loadCharsFromDB() : Promise.resolve()),
    (typeof loadChroniclesFromDB === 'function' ? loadChroniclesFromDB() : Promise.resolve()),
    (typeof loadDocumentsFromDB === 'function' ? loadDocumentsFromDB() : Promise.resolve()),
  ]);

  await Promise.all([
    (typeof loadCampaignsFromDB === 'function' ? loadCampaignsFromDB() : Promise.resolve()),
    (typeof ensureMapLayersCacheLoaded === 'function' ? ensureMapLayersCacheLoaded() : Promise.resolve()),
  ]);

  if (typeof renderList === 'function') renderList();
  if (typeof renderChroniclesList === 'function') renderChroniclesList();
  if (typeof renderDocumentsList === 'function') renderDocumentsList();
  if (typeof renderCampaignsList === 'function') renderCampaignsList();

  if (typeof _renderAllMarkers === 'function') _renderAllMarkers();
  if (typeof _renderLayerPanel === 'function') _renderLayerPanel();
}

// ══════════════════════════════════════════════════════════════
// TRADUCTIONS
// ══════════════════════════════════════════════════════════════

const TRANSFER_I18N = {
  fr: {
    transfer_modal_title:          'Transférer un élément',
    transfer_modal_desc:           'Cède la propriété d\'un de vos éléments à un autre joueur. Cette action est irréversible.',
    transfer_step1:                'Étape 1 — Type d\'élément',
    transfer_step2:                'Étape 2 — Élément à transférer',
    transfer_step3:                'Étape 3 — Destinataire',
    transfer_type_char:            'Personnage',
    transfer_type_chr:             'Chronique',
    transfer_type_doc:             'Document',
    transfer_item_select_ph:       'Choisissez un élément…',
    transfer_item_none:            'Aucun élément possédé de ce type',
    transfer_username_ph:          'Nom du joueur destinataire',
    transfer_warning_irreversible: 'Ce transfert est définitif. Vous perdrez la propriété de cet élément.',
    transfer_btn_confirm:          'Transférer',
    transfer_btn_in_progress:      'Transfert…',
    transfer_error_not_auth:       'Vous devez être connecté.',
    transfer_error_user_not_found: 'Joueur introuvable. Vérifiez le nom exact.',
    transfer_error_same_user:      'Vous ne pouvez pas vous transférer un élément à vous-même.',
    transfer_error_item_not_found: 'Élément introuvable.',
    transfer_error_not_owner:      'Vous n\'êtes pas le propriétaire de cet élément.',
    transfer_error_invalid_type:   'Type d\'élément invalide.',
    transfer_error_network:        'Erreur réseau :',
    transfer_error_unknown:        'Une erreur inattendue s\'est produite.',
    transfer_success:              'Transfert effectué avec succès !',
    user_transfer:                 'Transférer un élément',
  },
  en: {
    transfer_modal_title:          'Transfer an item',
    transfer_modal_desc:           'Give ownership of one of your items to another player. This action is irreversible.',
    transfer_step1:                'Step 1 — Item type',
    transfer_step2:                'Step 2 — Item to transfer',
    transfer_step3:                'Step 3 — Recipient',
    transfer_type_char:            'Character',
    transfer_type_chr:             'Chronicle',
    transfer_type_doc:             'Document',
    transfer_item_select_ph:       'Choose an item…',
    transfer_item_none:            'No item of this type owned',
    transfer_username_ph:          'Recipient player name',
    transfer_warning_irreversible: 'This transfer is permanent. You will lose ownership of this item.',
    transfer_btn_confirm:          'Transfer',
    transfer_btn_in_progress:      'Transferring…',
    transfer_error_not_auth:       'You must be logged in.',
    transfer_error_user_not_found: 'Player not found. Check the exact name.',
    transfer_error_same_user:      'You cannot transfer an item to yourself.',
    transfer_error_item_not_found: 'Item not found.',
    transfer_error_not_owner:      'You are not the owner of this item.',
    transfer_error_invalid_type:   'Invalid item type.',
    transfer_error_network:        'Network error:',
    transfer_error_unknown:        'An unexpected error occurred.',
    transfer_success:              'Transfer completed successfully!',
    user_transfer:                 'Transfer an item',
  },
};

Object.keys(TRANSFER_I18N).forEach(lang => {
  if (TRANSLATIONS[lang]) Object.assign(TRANSLATIONS[lang], TRANSFER_I18N[lang]);
});
