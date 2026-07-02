-- ══════════════════════════════════════════════════════════════
-- CAMPLY — Départ d'un univers : transfert de propriété au owner
-- À exécuter dans Supabase Dashboard > SQL Editor > New query
-- (nécessite sql/18_universes_phase1.sql et sql/19_campaign_sharing.sql)
-- ══════════════════════════════════════════════════════════════
--
-- Quand un membre quitte un univers (de son plein gré, ou après avoir
-- été retiré par un owner/admin), tout ce qu'il y a créé (personnages,
-- chroniques, documents, couche de carte + marqueurs) est transféré
-- au propriétaire de l'univers au lieu de rester bloqué derrière un
-- compte qui n'y a plus accès. Les tags personnels liés sont nettoyés
-- comme lors d'un transfert d'objet classique (cf. transfer_item /
-- _cleanup_char_tags_on_transfer / _cleanup_doc_tags_on_transfer).
--
-- Remplace la suppression directe de universe_members côté client :
-- le frontend doit désormais appeler ce RPC plutôt que
-- `sb.from('universe_members').delete()...`.
-- ══════════════════════════════════════════════════════════════

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
  v_char_id         UUID;
  v_doc_id          UUID;
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

  -- ── Personnages ────────────────────────────────────────────
  FOR v_char_id IN
    SELECT id FROM public.characters
    WHERE universe_id = p_universe_id AND user_id = p_user_id
  LOOP
    PERFORM public._cleanup_char_tags_on_transfer(v_char_id, p_user_id);
    UPDATE public.characters SET user_id = v_owner_id, updated_at = NOW() WHERE id = v_char_id;
  END LOOP;

  -- ── Chroniques (pas de système de tags) ───────────────────
  UPDATE public.chronicles
  SET user_id = v_owner_id, updated_at = NOW()
  WHERE universe_id = p_universe_id AND user_id = p_user_id;

  -- ── Documents ──────────────────────────────────────────────
  FOR v_doc_id IN
    SELECT id FROM public.documents
    WHERE universe_id = p_universe_id AND user_id = p_user_id
  LOOP
    PERFORM public._cleanup_doc_tags_on_transfer(v_doc_id, p_user_id);
    UPDATE public.documents SET user_id = v_owner_id, updated_at = NOW() WHERE id = v_doc_id;
  END LOOP;

  -- ── Couches de carte + marqueurs ──────────────────────────
  -- map_layers a une contrainte UNIQUE(user_id, map_key) : si le
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

  -- ── Tags personnels devenus orphelins (aucun objet ne les utilise) ──
  DELETE FROM public.tags
  WHERE universe_id = p_universe_id AND user_id = p_user_id
    AND NOT EXISTS (
      SELECT 1 FROM public.character_tags ct
      JOIN public.characters c ON c.id = ct.character_id
      WHERE ct.tag_id = tags.id
    )
    AND NOT EXISTS (
      SELECT 1 FROM public.followed_character_tags fct
      WHERE fct.tag_id = tags.id AND fct.user_id = p_user_id
    );

  DELETE FROM public.doc_tags
  WHERE universe_id = p_universe_id AND user_id = p_user_id
    AND NOT EXISTS (
      SELECT 1 FROM public.document_tags dt
      JOIN public.documents d ON d.id = dt.document_id
      WHERE dt.tag_id = doc_tags.id
    )
    AND NOT EXISTS (
      SELECT 1 FROM public.followed_document_tags fdt
      WHERE fdt.tag_id = doc_tags.id AND fdt.user_id = p_user_id
    );

  -- ── Retrait de l'univers ───────────────────────────────────
  DELETE FROM public.universe_members
  WHERE universe_id = p_universe_id AND user_id = p_user_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.remove_universe_member(UUID, UUID) TO authenticated;

-- ══════════════════════════════════════════════════════════════
-- Résumé :
--  • À appeler via sb.rpc('remove_universe_member', { p_universe_id, p_user_id })
--    aussi bien pour un départ volontaire (p_user_id = soi-même) que pour
--    un retrait par un owner/admin (p_user_id = la cible).
--  • Personnages / chroniques / documents / couches de carte + marqueurs
--    créés par le membre partant deviennent la propriété du owner.
--  • Les campagnes ne sont pas concernées : elles n'appartiennent déjà
--    qu'au owner (cf. sql/19_campaign_sharing.sql).
-- ══════════════════════════════════════════════════════════════

-- END sql/24_leave_universe_transfer_ownership.sql
