-- ═══════════════════════════════════════════════════════════════════
-- CAMPLY — Périmètre d'export d'une campagne
-- À coller dans : Supabase Dashboard > SQL Editor > New query
--
-- Retourne les identifiants des objets explicitement attachés à une
-- campagne et encore visibles pour l'appelant. Les jointures vers les
-- tables de contenu sont volontaires : avec SECURITY INVOKER, leurs
-- policies RLS éliminent les objets auxquels l'utilisateur n'a plus accès.
--
-- Le garde sur campaigns vérifie également que la campagne appartient à
-- l'univers demandé et que l'appelant est membre de la campagne, owner ou
-- MJ de l'univers.
-- ═══════════════════════════════════════════════════════════════════

BEGIN;

DROP FUNCTION IF EXISTS public.get_campaign_export_scope(uuid, uuid);

CREATE OR REPLACE FUNCTION public.get_campaign_export_scope(
  p_universe_id uuid,
  p_campaign_id uuid
)
RETURNS TABLE (
  object_type text,
  object_id   uuid
)
LANGUAGE sql
SECURITY INVOKER
STABLE
SET search_path = public
AS $$
  WITH requested_campaign AS (
    SELECT c.id
    FROM public.campaigns c
    WHERE c.id = p_campaign_id
      AND c.universe_id = p_universe_id
      AND (
        public.is_campaign_member(c.id, auth.uid())
        OR public.has_universe_role(c.universe_id, ARRAY['owner', 'gm'], auth.uid())
      )
  )
  SELECT 'character'::text, cvc.character_id
  FROM requested_campaign rc
  JOIN public.campaign_visible_characters cvc ON cvc.campaign_id = rc.id
  JOIN public.characters ch ON ch.id = cvc.character_id
  WHERE ch.universe_id = p_universe_id

  UNION ALL

  SELECT 'chronicle'::text, cvc.chronicle_id
  FROM requested_campaign rc
  JOIN public.campaign_visible_chronicles cvc ON cvc.campaign_id = rc.id
  JOIN public.chronicles ch ON ch.id = cvc.chronicle_id
  WHERE ch.universe_id = p_universe_id

  UNION ALL

  SELECT 'document'::text, cvd.document_id
  FROM requested_campaign rc
  JOIN public.campaign_visible_documents cvd ON cvd.campaign_id = rc.id
  JOIN public.documents d ON d.id = cvd.document_id
  WHERE d.universe_id = p_universe_id

  UNION ALL

  SELECT 'map'::text, cvm.map_layer_id
  FROM requested_campaign rc
  JOIN public.campaign_visible_maps cvm ON cvm.campaign_id = rc.id
  JOIN public.map_layers ml ON ml.id = cvm.map_layer_id
  WHERE ml.universe_id = p_universe_id;
$$;

REVOKE ALL ON FUNCTION public.get_campaign_export_scope(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_campaign_export_scope(uuid, uuid) TO authenticated;

COMMIT;
