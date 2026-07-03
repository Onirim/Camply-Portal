-- ══════════════════════════════════════════════════════════════
-- CAMPLY — Unification du système de tags
-- À exécuter sur une base ayant déjà reçu sql/00_fresh_install.sql
-- (jusqu'à sql/24_leave_universe_transfer_ownership.sql inclus).
--
-- Les tags redeviennent une organisation strictement personnelle :
-- un utilisateur pose ses tags sur n'importe quel personnage ou
-- document qu'il peut voir (les siens ou ceux d'un autre membre de
-- l'univers), indépendamment de qui possède l'objet. Il n'y a donc
-- plus lieu de distinguer "mes tags sur mes objets" (character_tags)
-- de "mes tags sur les objets des autres" (followed_character_tags) :
-- les deux sont fusionnés en une seule table par domaine.
--
-- Conséquence : plus aucun mécanisme ne copie les tags du créateur
-- d'un objet vers l'utilisateur qui le consulte (sync_owner_tags et
-- ses helpers sont supprimés — ils étaient de toute façon déjà
-- inertes côté frontend, et cassés depuis la suppression de
-- followed_characters/followed_documents dans sql/19_campaign_sharing.sql).
-- Un transfert de propriété (transfer_item, remove_universe_member)
-- ne touche donc plus aux tags : ce sont ceux de qui les a posés,
-- pas de qui possède l'objet.
--
-- Migration destructive : aucune donnée existante à préserver.
-- ══════════════════════════════════════════════════════════════

BEGIN;

-- ── 1. Personnages : character_tags + followed_character_tags → character_tags ──

DROP TABLE IF EXISTS public.character_tags CASCADE;
ALTER TABLE public.followed_character_tags RENAME TO character_tags;
ALTER TABLE public.character_tags DROP COLUMN IF EXISTS id;

ALTER TABLE public.character_tags DROP CONSTRAINT IF EXISTS followed_character_tags_pkey;
ALTER TABLE public.character_tags
  ADD CONSTRAINT character_tags_pkey PRIMARY KEY (universe_id, user_id, character_id, tag_id);

DROP INDEX IF EXISTS public.idx_followed_character_tags_user;
DROP INDEX IF EXISTS public.idx_followed_character_tags_character;
DROP INDEX IF EXISTS public.followed_character_tags_universe_user_idx;
CREATE INDEX IF NOT EXISTS character_tags_universe_user_idx ON public.character_tags(universe_id, user_id);
CREATE INDEX IF NOT EXISTS character_tags_character_idx     ON public.character_tags(character_id);

ALTER TABLE public.character_tags ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "character_tags_select" ON public.character_tags;
DROP POLICY IF EXISTS "character_tags_insert" ON public.character_tags;
DROP POLICY IF EXISTS "character_tags_delete" ON public.character_tags;
DROP POLICY IF EXISTS "Users manage their own followed tags" ON public.character_tags;
CREATE POLICY "character_tags_manage_own" ON public.character_tags
  FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- ── 2. Documents : document_tags + followed_document_tags → document_tags ──

DROP TABLE IF EXISTS public.document_tags CASCADE;
ALTER TABLE public.followed_document_tags RENAME TO document_tags;

ALTER TABLE public.document_tags DROP CONSTRAINT IF EXISTS followed_document_tags_pkey;
ALTER TABLE public.document_tags
  ADD CONSTRAINT document_tags_pkey PRIMARY KEY (universe_id, user_id, document_id, tag_id);

DROP INDEX IF EXISTS public.followed_document_tags_universe_user_idx;
CREATE INDEX IF NOT EXISTS document_tags_universe_user_idx ON public.document_tags(universe_id, user_id);
CREATE INDEX IF NOT EXISTS document_tags_document_idx      ON public.document_tags(document_id);

ALTER TABLE public.document_tags ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Users manage own document tags" ON public.document_tags;
DROP POLICY IF EXISTS "Users manage own followed doc tags" ON public.document_tags;
CREATE POLICY "document_tags_manage_own" ON public.document_tags
  FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- ── 3. Fonctions obsolètes de partage/sync ────────────────────

DROP FUNCTION IF EXISTS public._cleanup_char_tags_on_transfer(UUID, UUID);
DROP FUNCTION IF EXISTS public._cleanup_doc_tags_on_transfer(UUID, UUID);
DROP FUNCTION IF EXISTS public.sync_owner_tags(TEXT, TEXT);
DROP FUNCTION IF EXISTS public.sync_char_tags_to_follower(UUID, UUID);
DROP FUNCTION IF EXISTS public.sync_doc_tags_to_follower(UUID, UUID);

-- ── 4. cleanup_orphan_char_tags / cleanup_orphan_doc_tags — adaptées ──

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
    SELECT t.id
    FROM   public.tags t
    WHERE  t.user_id = p_user_id
      AND  NOT EXISTS (
             SELECT 1 FROM public.character_tags ct
             WHERE ct.tag_id = t.id AND ct.user_id = p_user_id
           )
  LOOP
    DELETE FROM public.tags WHERE id = v_tag_id AND user_id = p_user_id;
  END LOOP;
END;
$$;

GRANT EXECUTE ON FUNCTION public.cleanup_orphan_char_tags(UUID) TO authenticated;

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
             SELECT 1 FROM public.document_tags dt
             WHERE dt.tag_id = t.id AND dt.user_id = p_user_id
           )
  LOOP
    DELETE FROM public.doc_tags WHERE id = v_tag_id AND user_id = p_user_id;
  END LOOP;
END;
$$;

GRANT EXECUTE ON FUNCTION public.cleanup_orphan_doc_tags(UUID) TO authenticated;

-- ── 5. transfer_item — ne nettoie plus les tags (ils restent à qui les a posés) ──

CREATE OR REPLACE FUNCTION public.transfer_item(
  p_item_type   TEXT,
  p_item_id     UUID,
  p_to_username TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_caller_id    UUID := auth.uid();
  v_target_id    UUID;
  v_item_user_id UUID;
  v_map_key      TEXT;
BEGIN
  IF v_caller_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'not_authenticated');
  END IF;

  SELECT id INTO v_target_id
  FROM public.profiles
  WHERE lower(username) = lower(trim(p_to_username))
  LIMIT 1;

  IF v_target_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'user_not_found');
  END IF;

  IF v_target_id = v_caller_id THEN
    RETURN jsonb_build_object('ok', false, 'error', 'same_user');
  END IF;

  IF p_item_type = 'char' THEN
    SELECT user_id INTO v_item_user_id FROM public.characters WHERE id = p_item_id;
    IF v_item_user_id IS NULL THEN RETURN jsonb_build_object('ok', false, 'error', 'item_not_found'); END IF;
    IF v_item_user_id <> v_caller_id THEN RETURN jsonb_build_object('ok', false, 'error', 'not_owner'); END IF;
    UPDATE public.characters SET user_id = v_target_id, updated_at = NOW() WHERE id = p_item_id;

  ELSIF p_item_type = 'chr' THEN
    SELECT user_id INTO v_item_user_id FROM public.chronicles WHERE id = p_item_id;
    IF v_item_user_id IS NULL THEN RETURN jsonb_build_object('ok', false, 'error', 'item_not_found'); END IF;
    IF v_item_user_id <> v_caller_id THEN RETURN jsonb_build_object('ok', false, 'error', 'not_owner'); END IF;
    UPDATE public.chronicles SET user_id = v_target_id, updated_at = NOW() WHERE id = p_item_id;

  ELSIF p_item_type = 'doc' THEN
    SELECT user_id INTO v_item_user_id FROM public.documents WHERE id = p_item_id;
    IF v_item_user_id IS NULL THEN RETURN jsonb_build_object('ok', false, 'error', 'item_not_found'); END IF;
    IF v_item_user_id <> v_caller_id THEN RETURN jsonb_build_object('ok', false, 'error', 'not_owner'); END IF;
    UPDATE public.documents SET user_id = v_target_id, updated_at = NOW() WHERE id = p_item_id;

  ELSIF p_item_type = 'map' THEN
    SELECT user_id, map_key INTO v_item_user_id, v_map_key FROM public.map_layers WHERE id = p_item_id;
    IF v_item_user_id IS NULL THEN RETURN jsonb_build_object('ok', false, 'error', 'item_not_found'); END IF;
    IF v_item_user_id <> v_caller_id THEN RETURN jsonb_build_object('ok', false, 'error', 'not_owner'); END IF;
    -- Transfère uniquement les marqueurs de la carte concernée (comme avant).
    UPDATE public.map_markers
      SET user_id = v_target_id, updated_at = NOW()
      WHERE user_id = v_caller_id AND map_key = v_map_key;
    UPDATE public.map_layers
      SET user_id = v_target_id, updated_at = NOW()
      WHERE id = p_item_id;

  ELSE
    RETURN jsonb_build_object('ok', false, 'error', 'invalid_type');
  END IF;

  RETURN jsonb_build_object('ok', true, 'item_id', p_item_id, 'to_user_id', v_target_id);
END;
$$;

GRANT EXECUTE ON FUNCTION public.transfer_item(TEXT, UUID, TEXT) TO authenticated;

-- ── 6. remove_universe_member — idem, plus nettoyage tags du partant ──

CREATE OR REPLACE FUNCTION public.remove_universe_member(
  p_universe_id UUID,
  p_user_id     UUID
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_owner_id        UUID;
  v_map_key         TEXT;
  v_owner_has_layer BOOLEAN;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;

  SELECT owner_id INTO v_owner_id
  FROM public.universes
  WHERE id = p_universe_id;

  IF v_owner_id IS NULL THEN
    RAISE EXCEPTION 'Univers introuvable';
  END IF;

  IF p_user_id = v_owner_id THEN
    RAISE EXCEPTION 'Le propriétaire ne peut pas quitter son propre univers';
  END IF;

  IF auth.uid() <> p_user_id AND NOT public.has_universe_role(p_universe_id, ARRAY['owner','admin']) THEN
    RAISE EXCEPTION 'Non autorisé';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.universe_members
    WHERE universe_id = p_universe_id AND user_id = p_user_id
  ) THEN
    RAISE EXCEPTION 'Cet utilisateur n''est pas membre de cet univers';
  END IF;

  -- ── Personnages / chroniques / documents : transfert direct au owner ──
  UPDATE public.characters SET user_id = v_owner_id, updated_at = NOW()
    WHERE universe_id = p_universe_id AND user_id = p_user_id;
  UPDATE public.chronicles SET user_id = v_owner_id, updated_at = NOW()
    WHERE universe_id = p_universe_id AND user_id = p_user_id;
  UPDATE public.documents SET user_id = v_owner_id, updated_at = NOW()
    WHERE universe_id = p_universe_id AND user_id = p_user_id;

  -- ── Couches de carte + marqueurs ──────────────────────────
  -- map_layers a une contrainte UNIQUE(universe_id, user_id, map_key) : si le
  -- propriétaire possède déjà une couche pour cette carte, on fusionne
  -- les marqueurs dans la sienne et on supprime la couche devenue vide
  -- plutôt que de réassigner (ce qui violerait la contrainte).
  FOR v_map_key IN
    SELECT DISTINCT map_key FROM public.map_layers
    WHERE universe_id = p_universe_id AND user_id = p_user_id
  LOOP
    UPDATE public.map_markers
    SET user_id = v_owner_id, updated_at = NOW()
    WHERE universe_id = p_universe_id AND user_id = p_user_id AND map_key = v_map_key;

    SELECT EXISTS (
      SELECT 1 FROM public.map_layers
      WHERE universe_id = p_universe_id AND user_id = v_owner_id AND map_key = v_map_key
    ) INTO v_owner_has_layer;

    IF v_owner_has_layer THEN
      DELETE FROM public.map_layers
      WHERE universe_id = p_universe_id AND user_id = p_user_id AND map_key = v_map_key;
    ELSE
      UPDATE public.map_layers
      SET user_id = v_owner_id, updated_at = NOW()
      WHERE universe_id = p_universe_id AND user_id = p_user_id AND map_key = v_map_key;
    END IF;
  END LOOP;

  -- ── Tags personnels du partant, pour cet univers ──────────────
  -- Ce sont ses tags à lui (indépendants des objets qu'il possédait) :
  -- ils n'ont plus de raison d'exister une fois qu'il a quitté l'univers.
  -- Cascade automatiquement sur character_tags / document_tags.
  DELETE FROM public.tags     WHERE universe_id = p_universe_id AND user_id = p_user_id;
  DELETE FROM public.doc_tags WHERE universe_id = p_universe_id AND user_id = p_user_id;

  -- ── Retrait de l'univers ───────────────────────────────────
  DELETE FROM public.universe_members
  WHERE universe_id = p_universe_id AND user_id = p_user_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.remove_universe_member(UUID, UUID) TO authenticated;

COMMIT;

-- ══════════════════════════════════════════════════════════════
-- Résumé :
--  • character_tags(user_id, character_id, tag_id, universe_id) et
--    document_tags(user_id, document_id, tag_id, universe_id) sont
--    désormais les seules tables de liaison, quel que soit le
--    propriétaire de l'objet tagué.
--  • Le frontend doit appeler ces deux tables directement (avec
--    eq('user_id', currentUser.id)) au lieu de distinguer
--    character_tags / followed_character_tags.
--  • sync_owner_tags, sync_char_tags_to_follower, sync_doc_tags_to_follower,
--    _cleanup_char_tags_on_transfer, _cleanup_doc_tags_on_transfer
--    n'existent plus.
-- ══════════════════════════════════════════════════════════════
