// ══════════════════════════════════════════════════════════════
// Camply — Liens d'invitation d'univers
// Génération côté propriétaire, aperçu + adhésion côté invité
// ══════════════════════════════════════════════════════════════

let universeInviteState = { token: null, expires_at: null };

function buildInviteUrl(token) {
  const base = window.location.href.split('#')[0];
  return `${base}#invite/${token}`;
}

// ── Côté propriétaire (écran de configuration) ─────────────────

async function loadUniverseInviteForConfig() {
  universeInviteState = { token: null, expires_at: null };
  renderUniverseInviteBlock();
  if (!currentUniverse) return;

  const { data, error } = await sb.from('universe_invites')
    .select('token, expires_at')
    .eq('universe_id', currentUniverse.id)
    .maybeSingle();
  if (error) { console.error('Erreur chargement invitation:', error); return; }

  const expired = data && new Date(data.expires_at) < new Date();
  universeInviteState = (data && !expired) ? data : { token: null, expires_at: null };
  renderUniverseInviteBlock();
}

function renderUniverseInviteBlock() {
  const el = document.getElementById('config-invite-link-block');
  if (!el) return;

  if (universeInviteState.token) {
    const url = buildInviteUrl(universeInviteState.token);
    const dateStr = new Date(universeInviteState.expires_at).toLocaleDateString();
    el.innerHTML = `
      <div class="config-action-row" style="margin-bottom:8px">
        <input class="config-action-input" type="text" id="config-invite-link-input" readonly value="${esc(url)}" onclick="this.select()">
        <button class="config-action-btn" onclick="copyInviteLink()">${t('config_invite_copy_btn')}</button>
      </div>
      <p class="config-block-hint">${ti('config_invite_expires_hint', { date: dateStr })}</p>
      <button class="config-action-btn" style="margin-top:8px" onclick="generateUniverseInviteLink()">${t('config_invite_regenerate_btn')}</button>
    `;
  } else {
    el.innerHTML = `<button class="config-action-btn" onclick="generateUniverseInviteLink()">${t('config_invite_generate_btn')}</button>`;
  }
}

function copyInviteLink() {
  if (!universeInviteState.token) return;
  copyUrl(buildInviteUrl(universeInviteState.token));
}

async function generateUniverseInviteLink() {
  if (!canConfigureUniverse() || !currentUniverse) return;
  const { data, error } = await sb.rpc('generate_universe_invite', { p_universe_id: currentUniverse.id });
  if (error || !data?.length) { showToast(t('toast_invite_link_error')); return; }
  universeInviteState = { token: data[0].token, expires_at: data[0].expires_at };
  renderUniverseInviteBlock();
  copyInviteLink();
  showToast(t('toast_invite_link_generated'));
}

// ── Côté invité (clic sur le lien) ──────────────────────────────

function inviteIcon() {
  return `<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" width="16" height="16">
    <path d="M6.5 9.5a3 3 0 0 0 4 0.3l2-2a3 3 0 0 0-4-4.3l-1 1" stroke-linecap="round"/>
    <path d="M9.5 6.5a3 3 0 0 0-4-0.3l-2 2a3 3 0 0 0 4 4.3l1-1" stroke-linecap="round"/>
  </svg>`;
}

function closeInviteJoinModal() {
  const modal = document.getElementById('invite-join-modal');
  if (modal) modal.style.display = 'none';
  clearHash();
}

async function handleInviteHash(token) {
  const modal = document.getElementById('invite-join-modal');
  const body  = document.getElementById('invite-join-modal-body');
  if (!modal || !body) return;

  modal.style.display = 'flex';
  body.innerHTML = `<p class="config-block-hint">${t('invite_loading')}</p>`;

  const { data, error } = await sb.rpc('get_universe_invite_preview', { p_token: token });
  const preview = data?.[0];
  if (error || !preview) {
    body.innerHTML = `<div class="transfer-error-msg" style="display:flex">${t('invite_not_found')}</div>
      <div class="transfer-actions"><button class="btn-cancel" onclick="closeInviteJoinModal()">${t('btn_cancel')}</button></div>`;
    return;
  }

  const illus = preview.illustration_url
    ? `<img class="invite-modal-illus" src="${esc(preview.illustration_url)}" style="object-position:center ${preview.illustration_position || 0}%" alt="">`
    : '';

  if (preview.is_expired) {
    body.innerHTML = `
      ${illus}
      <div class="form-section-title" style="margin:0 20px 8px">${esc(preview.name)}</div>
      <div class="transfer-error-msg" style="display:flex">${t('invite_expired')}</div>
      <div class="transfer-actions"><button class="btn-cancel" onclick="closeInviteJoinModal()">${t('btn_cancel')}</button></div>
    `;
    return;
  }

  if (preview.is_member) {
    body.innerHTML = `
      ${illus}
      <div class="form-section-title" style="margin:0 20px 8px">${esc(preview.name)}</div>
      <p class="transfer-desc" style="border-bottom:none">${t('invite_already_member')}</p>
      <div class="transfer-actions">
        <button class="transfer-confirm-btn" onclick="goToInvitedUniverse('${preview.universe_id}')">${t('invite_enter_btn')}</button>
      </div>
    `;
    return;
  }

  body.innerHTML = `
    ${illus}
    <div class="form-section-title" style="margin:0 20px 8px">${esc(preview.name)}</div>
    <p class="transfer-desc" style="border-bottom:none">${esc(preview.description) || t('invite_no_description')}</p>
    <div class="transfer-actions">
      <button class="btn-cancel" onclick="closeInviteJoinModal()">${t('btn_cancel')}</button>
      <button class="transfer-confirm-btn" onclick="acceptUniverseInvite('${token}')">${t('invite_join_btn')}</button>
    </div>
  `;
}

async function acceptUniverseInvite(token) {
  const { data: universeId, error } = await sb.rpc('accept_universe_invite', { p_token: token });
  if (error || !universeId) { showToast(t('toast_invite_link_accept_error')); return; }
  showToast(t('invite_joined_toast'));
  await loadUniversesFromDB();
  await goToInvitedUniverse(universeId);
}

async function goToInvitedUniverse(universeId) {
  const modal = document.getElementById('invite-join-modal');
  if (modal) modal.style.display = 'none';
  clearHash();
  await enterUniverse(universeId);
}
