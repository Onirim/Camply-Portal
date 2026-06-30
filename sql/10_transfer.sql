-- ══════════════════════════════════════════════════════════════
-- MYSTIC FALLS — Migration : Transfert d'éléments entre joueurs
-- À coller dans : Supabase Dashboard > SQL Editor > New query
-- ══════════════════════════════════════════════════════════════
--
-- Problème RLS : un utilisateur ne peut mettre à jour que ses
-- propres lignes (user_id = auth.uid()). Pour changer le
-- propriétaire d'un objet, il faut contourner le RLS via une
-- fonction SECURITY DEFINER (qui s'exécute avec les droits du
-- propriétaire de la fonction, soit postgres/service_role).
--
-- Sécurité maintenue :
--   1. L'appelant doit être authentifié.
--   2. L'objet doit appartenir à l'appelant (auth.uid()).
--   3. Le destinataire doit exister dans public.profiles.
--   4. On ne peut pas se transférer un objet à soi-même.
-- ══════════════════════════════════════════════════════════════


-- ── Fonction générique de transfert ──────────────────────────

CREATE OR REPLACE FUNCTION public.transfer_item(
  p_item_type   TEXT,   -- 'char' | 'chr' | 'doc' | 'campaign'
  p_share_code  TEXT,   -- code de partage de l'objet
  p_to_username TEXT    -- nom d'utilisateur du destinataire
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER   -- contourne le RLS ; la sécurité est gérée manuellement ci-dessous
SET search_path = public
AS $$
DECLARE
  v_caller_id    UUID := auth.uid();
  v_target_id    UUID;
  v_item_id      UUID;
  v_item_user_id UUID;
BEGIN

  -- 1. L'appelant doit être connecté
  IF v_caller_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'not_authenticated');
  END IF;

  -- 2. Résoudre le destinataire
  SELECT id INTO v_target_id
  FROM public.profiles
  WHERE lower(username) = lower(trim(p_to_username))
  LIMIT 1;

  IF v_target_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'user_not_found');
  END IF;

  -- 3. Pas de transfert vers soi-même
  IF v_target_id = v_caller_id THEN
    RETURN jsonb_build_object('ok', false, 'error', 'same_user');
  END IF;

  -- ── CAS : personnage ────────────────────────────────────────
  IF p_item_type = 'char' THEN

    SELECT id, user_id INTO v_item_id, v_item_user_id
    FROM public.characters
    WHERE share_code = upper(trim(p_share_code))
    LIMIT 1;

    IF v_item_id IS NULL THEN
      RETURN jsonb_build_object('ok', false, 'error', 'item_not_found');
    END IF;
    IF v_item_user_id <> v_caller_id THEN
      RETURN jsonb_build_object('ok', false, 'error', 'not_owner');
    END IF;

    -- Nettoyer les tags orphelins AVANT le transfert
    -- (les character_tags appartiennent à l'ancien user via les tags)
    PERFORM public._cleanup_char_tags_on_transfer(v_item_id, v_caller_id);

    -- Supprimer les followed_characters de l'ancien proprio sur cet objet
    DELETE FROM public.followed_characters
    WHERE character_id = v_item_id AND user_id = v_caller_id;

    -- Transférer
    UPDATE public.characters
    SET user_id = v_target_id, updated_at = NOW()
    WHERE id = v_item_id;

  -- ── CAS : chronique ─────────────────────────────────────────
  ELSIF p_item_type = 'chr' THEN

    SELECT id, user_id INTO v_item_id, v_item_user_id
    FROM public.chronicles
    WHERE share_code = upper(trim(p_share_code))
    LIMIT 1;

    IF v_item_id IS NULL THEN
      RETURN jsonb_build_object('ok', false, 'error', 'item_not_found');
    END IF;
    IF v_item_user_id <> v_caller_id THEN
      RETURN jsonb_build_object('ok', false, 'error', 'not_owner');
    END IF;

    -- Supprimer l'abonnement éventuel de l'ancien proprio
    DELETE FROM public.followed_chronicles
    WHERE chronicle_id = v_item_id AND user_id = v_caller_id;

    UPDATE public.chronicles
    SET user_id = v_target_id, updated_at = NOW()
    WHERE id = v_item_id;

  -- ── CAS : document ──────────────────────────────────────────
  ELSIF p_item_type = 'doc' THEN

    SELECT id, user_id INTO v_item_id, v_item_user_id
    FROM public.documents
    WHERE share_code = upper(trim(p_share_code))
    LIMIT 1;

    IF v_item_id IS NULL THEN
      RETURN jsonb_build_object('ok', false, 'error', 'item_not_found');
    END IF;
    IF v_item_user_id <> v_caller_id THEN
      RETURN jsonb_build_object('ok', false, 'error', 'not_owner');
    END IF;

    -- Nettoyer les doc_tags orphelins
    PERFORM public._cleanup_doc_tags_on_transfer(v_item_id, v_caller_id);

    DELETE FROM public.followed_documents
    WHERE document_id = v_item_id AND user_id = v_caller_id;

    UPDATE public.documents
    SET user_id = v_target_id, updated_at = NOW()
    WHERE id = v_item_id;

  -- ── CAS : campagne ──────────────────────────────────────────
  ELSIF p_item_type = 'campaign' THEN

    SELECT id, user_id INTO v_item_id, v_item_user_id
    FROM public.campaigns
    WHERE share_code = upper(trim(p_share_code))
    LIMIT 1;

    IF v_item_id IS NULL THEN
      RETURN jsonb_build_object('ok', false, 'error', 'item_not_found');
    END IF;
    IF v_item_user_id <> v_caller_id THEN
      RETURN jsonb_build_object('ok', false, 'error', 'not_owner');
    END IF;

    DELETE FROM public.followed_campaigns
    WHERE campaign_id = v_item_id AND user_id = v_caller_id;

    UPDATE public.campaigns
    SET user_id = v_target_id, updated_at = NOW()
    WHERE id = v_item_id;

  ELSE
    RETURN jsonb_build_object('ok', false, 'error', 'invalid_type');
  END IF;

  RETURN jsonb_build_object('ok', true, 'item_id', v_item_id, 'to_user_id', v_target_id);
END;
$$;

-- Autoriser les utilisateurs connectés à appeler cette fonction
GRANT EXECUTE ON FUNCTION public.transfer_item(TEXT, TEXT, TEXT) TO authenticated;


-- ── Helper : nettoyage des tags personnage avant transfert ────
-- Supprime les liaisons character_tags de cet item pour l'ancien
-- propriétaire, puis supprime les tags devenu orphelins.

CREATE OR REPLACE FUNCTION public._cleanup_char_tags_on_transfer(
  p_char_id UUID,
  p_user_id UUID
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_tag_id UUID;
  v_count  INT;
BEGIN
  -- Pour chaque tag lié au personnage transféré
  FOR v_tag_id IN
    SELECT tag_id FROM public.character_tags WHERE character_id = p_char_id
  LOOP
    -- Vérifie si ce tag est encore utilisé ailleurs par cet utilisateur
    SELECT COUNT(*) INTO v_count
    FROM public.character_tags ct
    JOIN public.characters c ON c.id = ct.character_id
    WHERE ct.tag_id = v_tag_id
      AND c.user_id = p_user_id
      AND c.id <> p_char_id;

    -- Aussi dans les followed_character_tags
    IF v_count = 0 THEN
      SELECT COUNT(*) INTO v_count
      FROM public.followed_character_tags
      WHERE tag_id = v_tag_id AND user_id = p_user_id;
    END IF;

    -- Tag orphelin → on le supprime
    IF v_count = 0 THEN
      DELETE FROM public.tags WHERE id = v_tag_id AND user_id = p_user_id;
    END IF;
  END LOOP;

  -- Supprime les liaisons character_tags pour ce personnage
  DELETE FROM public.character_tags WHERE character_id = p_char_id;

  -- Supprime aussi les followed_character_tags locaux d'autres users
  DELETE FROM public.followed_character_tags WHERE character_id = p_char_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public._cleanup_char_tags_on_transfer(UUID, UUID) TO authenticated;


-- ── Helper : nettoyage des tags document avant transfert ──────

CREATE OR REPLACE FUNCTION public._cleanup_doc_tags_on_transfer(
  p_doc_id  UUID,
  p_user_id UUID
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_tag_id UUID;
  v_count  INT;
BEGIN
  FOR v_tag_id IN
    SELECT tag_id FROM public.document_tags WHERE document_id = p_doc_id
  LOOP
    SELECT COUNT(*) INTO v_count
    FROM public.document_tags dt
    JOIN public.documents d ON d.id = dt.document_id
    WHERE dt.tag_id = v_tag_id
      AND d.user_id = p_user_id
      AND d.id <> p_doc_id;

    IF v_count = 0 THEN
      SELECT COUNT(*) INTO v_count
      FROM public.followed_document_tags
      WHERE tag_id = v_tag_id AND user_id = p_user_id;
    END IF;

    IF v_count = 0 THEN
      DELETE FROM public.doc_tags WHERE id = v_tag_id AND user_id = p_user_id;
    END IF;
  END LOOP;

  DELETE FROM public.document_tags WHERE document_id = p_doc_id;
  DELETE FROM public.followed_document_tags WHERE document_id = p_doc_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public._cleanup_doc_tags_on_transfer(UUID, UUID) TO authenticated;


-- ══════════════════════════════════════════════════════════════
-- Résumé de ce que fait ce fichier :
--
--  • transfer_item(type, share_code, username)
--      RPC appelable depuis le client JS via sb.rpc().
--      Vérifie que l'appelant est bien le propriétaire, résout
--      le destinataire par username, nettoie les tags orphelins,
--      puis change le user_id de la ligne concernée.
--
--  • _cleanup_char_tags_on_transfer / _cleanup_doc_tags_on_transfer
--      Fonctions internes appelées par transfer_item.
--      Suppriment les liaisons tags de l'objet transféré et
--      purgent les tags devenus orphelins pour l'ancien proprio.
--
-- Sécurité : SECURITY DEFINER + vérification explicite de
-- auth.uid() = v_item_user_id avant tout UPDATE.
-- ══════════════════════════════════════════════════════════════
