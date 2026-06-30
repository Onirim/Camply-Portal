-- ══════════════════════════════════════════════════════════════
-- ENERGY SYSTEM — Patch : sync tags propriétaire → abonnés (v2)
-- Corrections :
--   1. Signature RPC compatible PostgREST (p_item_id en TEXT
--      pour éviter les erreurs de cast depuis le JS, converti
--      en UUID en interne)
--   2. Fonction cleanup_follower_tags : supprime les tags
--      devenus orphelins quand un abonné se désabonne ou
--      retire un tag local
-- ══════════════════════════════════════════════════════════════

-- ── 1. sync_char_tags_to_follower ─────────────────────────────

CREATE OR REPLACE FUNCTION public.sync_char_tags_to_follower(
  p_character_id UUID,
  p_follower_id  UUID
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  r            RECORD;
  v_new_tag_id UUID;
BEGIN
  FOR r IN
    SELECT t.name, t.color
    FROM   public.character_tags ct
    JOIN   public.tags t ON t.id = ct.tag_id
    WHERE  ct.character_id = p_character_id
  LOOP
    -- Cherche un tag du même nom chez l'abonné
    SELECT id INTO v_new_tag_id
    FROM   public.tags
    WHERE  user_id = p_follower_id
      AND  lower(name) = lower(r.name)
    LIMIT 1;

    -- Crée-le si absent
    IF v_new_tag_id IS NULL THEN
      INSERT INTO public.tags (user_id, name, color)
      VALUES (p_follower_id, r.name, r.color)
      ON CONFLICT (user_id, name) DO NOTHING
      RETURNING id INTO v_new_tag_id;

      IF v_new_tag_id IS NULL THEN
        SELECT id INTO v_new_tag_id
        FROM   public.tags
        WHERE  user_id = p_follower_id AND lower(name) = lower(r.name)
        LIMIT 1;
      END IF;
    END IF;

    IF v_new_tag_id IS NOT NULL THEN
      INSERT INTO public.followed_character_tags (user_id, character_id, tag_id)
      VALUES (p_follower_id, p_character_id, v_new_tag_id)
      ON CONFLICT DO NOTHING;
    END IF;
  END LOOP;
END;
$$;

GRANT EXECUTE ON FUNCTION public.sync_char_tags_to_follower(UUID, UUID) TO authenticated;


-- ── 2. sync_doc_tags_to_follower ──────────────────────────────

CREATE OR REPLACE FUNCTION public.sync_doc_tags_to_follower(
  p_document_id UUID,
  p_follower_id UUID
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  r            RECORD;
  v_new_tag_id UUID;
BEGIN
  FOR r IN
    SELECT t.name, t.color
    FROM   public.document_tags dt
    JOIN   public.doc_tags t ON t.id = dt.tag_id
    WHERE  dt.document_id = p_document_id
  LOOP
    SELECT id INTO v_new_tag_id
    FROM   public.doc_tags
    WHERE  user_id = p_follower_id
      AND  lower(name) = lower(r.name)
    LIMIT 1;

    IF v_new_tag_id IS NULL THEN
      INSERT INTO public.doc_tags (user_id, name, color)
      VALUES (p_follower_id, r.name, r.color)
      ON CONFLICT (user_id, name) DO NOTHING
      RETURNING id INTO v_new_tag_id;

      IF v_new_tag_id IS NULL THEN
        SELECT id INTO v_new_tag_id
        FROM   public.doc_tags
        WHERE  user_id = p_follower_id AND lower(name) = lower(r.name)
        LIMIT 1;
      END IF;
    END IF;

    IF v_new_tag_id IS NOT NULL THEN
      INSERT INTO public.followed_document_tags (user_id, document_id, tag_id)
      VALUES (p_follower_id, p_document_id, v_new_tag_id)
      ON CONFLICT DO NOTHING;
    END IF;
  END LOOP;
END;
$$;

GRANT EXECUTE ON FUNCTION public.sync_doc_tags_to_follower(UUID, UUID) TO authenticated;


-- ── 3. sync_owner_tags — RPC principale ───────────────────────
-- p_item_id est déclaré en TEXT pour éviter les erreurs de cast
-- PostgREST quand le JS envoie une chaîne UUID.

DROP FUNCTION IF EXISTS public.sync_owner_tags(TEXT, UUID);
DROP FUNCTION IF EXISTS public.sync_owner_tags(TEXT, TEXT);

CREATE OR REPLACE FUNCTION public.sync_owner_tags(
  p_item_type TEXT,
  p_item_id   TEXT   -- reçu comme TEXT depuis PostgREST, converti en UUID en interne
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_caller_id UUID := auth.uid();
  v_uuid      UUID;
BEGIN
  IF v_caller_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'not_authenticated');
  END IF;

  -- Cast sécurisé TEXT → UUID
  BEGIN
    v_uuid := p_item_id::UUID;
  EXCEPTION WHEN invalid_text_representation THEN
    RETURN jsonb_build_object('ok', false, 'error', 'invalid_uuid');
  END;

  IF p_item_type = 'char' THEN
    IF NOT EXISTS (
      SELECT 1 FROM public.followed_characters
      WHERE  user_id = v_caller_id AND character_id = v_uuid
    ) AND NOT EXISTS (
      SELECT 1 FROM public.characters
      WHERE  id = v_uuid AND user_id = v_caller_id
    ) THEN
      RETURN jsonb_build_object('ok', false, 'error', 'not_follower');
    END IF;
    PERFORM public.sync_char_tags_to_follower(v_uuid, v_caller_id);

  ELSIF p_item_type = 'doc' THEN
    IF NOT EXISTS (
      SELECT 1 FROM public.followed_documents
      WHERE  user_id = v_caller_id AND document_id = v_uuid
    ) AND NOT EXISTS (
      SELECT 1 FROM public.documents
      WHERE  id = v_uuid AND user_id = v_caller_id
    ) THEN
      RETURN jsonb_build_object('ok', false, 'error', 'not_follower');
    END IF;
    PERFORM public.sync_doc_tags_to_follower(v_uuid, v_caller_id);

  ELSE
    RETURN jsonb_build_object('ok', false, 'error', 'invalid_type');
  END IF;

  RETURN jsonb_build_object('ok', true);
END;
$$;

GRANT EXECUTE ON FUNCTION public.sync_owner_tags(TEXT, TEXT) TO authenticated;


-- ── 4. cleanup_orphan_char_tags ───────────────────────────────
-- Supprime les tags de l'abonné (table `tags`) qui ne sont plus
-- utilisés nulle part après un désabonnement ou un retrait de tag.
-- Appelée depuis le JS après unfollowChar() ou removeFollowedTag().

CREATE OR REPLACE FUNCTION public.cleanup_orphan_char_tags(
  p_user_id UUID
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_tag_id UUID;
BEGIN
  FOR v_tag_id IN
    -- Tags de cet utilisateur qui ne sont plus liés à rien
    SELECT t.id
    FROM   public.tags t
    WHERE  t.user_id = p_user_id
      AND  NOT EXISTS (
             SELECT 1 FROM public.character_tags ct WHERE ct.tag_id = t.id
           )
      AND  NOT EXISTS (
             SELECT 1 FROM public.followed_character_tags fct
             WHERE  fct.tag_id = t.id AND fct.user_id = p_user_id
           )
  LOOP
    DELETE FROM public.tags WHERE id = v_tag_id AND user_id = p_user_id;
  END LOOP;
END;
$$;

GRANT EXECUTE ON FUNCTION public.cleanup_orphan_char_tags(UUID) TO authenticated;


-- ── 5. cleanup_orphan_doc_tags ────────────────────────────────

CREATE OR REPLACE FUNCTION public.cleanup_orphan_doc_tags(
  p_user_id UUID
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_tag_id UUID;
BEGIN
  FOR v_tag_id IN
    SELECT t.id
    FROM   public.doc_tags t
    WHERE  t.user_id = p_user_id
      AND  NOT EXISTS (
             SELECT 1 FROM public.document_tags dt WHERE dt.tag_id = t.id
           )
      AND  NOT EXISTS (
             SELECT 1 FROM public.followed_document_tags fdt
             WHERE  fdt.tag_id = t.id AND fdt.user_id = p_user_id
           )
  LOOP
    DELETE FROM public.doc_tags WHERE id = v_tag_id AND user_id = p_user_id;
  END LOOP;
END;
$$;

GRANT EXECUTE ON FUNCTION public.cleanup_orphan_doc_tags(UUID) TO authenticated;
