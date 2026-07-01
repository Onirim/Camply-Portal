-- ══════════════════════════════════════════════════════════════
-- Camply Portal — Correctif : récursion infinie RLS campaigns
-- À exécuter sur une base ayant déjà reçu sql/19_campaign_sharing.sql.
--
-- Bug : campaigns_select interroge campaign_members en EXISTS(...) et
-- campaign_members_select/insert/delete interrogent campaigns en
-- EXISTS(...). Les deux tables ayant RLS activé, évaluer la policy de
-- l'une déclenche l'évaluation de la policy de l'autre, qui rappelle
-- la première : Postgres lève 42P17 "infinite recursion detected in
-- policy for relation campaigns".
--
-- Correctif : router ces vérifications croisées par des fonctions
-- SECURITY DEFINER (même schéma que has_universe_role /
-- shares_campaign_with), qui contournent le RLS de la table
-- interrogée en leur sein et cassent donc le cycle.
-- ══════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.is_campaign_member(
  p_campaign_id UUID,
  p_user_id     UUID DEFAULT auth.uid()
)
RETURNS BOOLEAN
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.campaign_members cm
    WHERE cm.campaign_id = p_campaign_id AND cm.user_id = p_user_id
  );
$$;

GRANT EXECUTE ON FUNCTION public.is_campaign_member(UUID, UUID) TO authenticated;

CREATE OR REPLACE FUNCTION public.is_campaign_universe_owner(
  p_campaign_id UUID,
  p_user_id     UUID DEFAULT auth.uid()
)
RETURNS BOOLEAN
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.campaigns c
    WHERE c.id = p_campaign_id
      AND public.has_universe_role(c.universe_id, ARRAY['owner'], p_user_id)
  );
$$;

GRANT EXECUTE ON FUNCTION public.is_campaign_universe_owner(UUID, UUID) TO authenticated;

-- campaigns_select : remplace le EXISTS(campaign_members) brut
DROP POLICY IF EXISTS "campaigns_select" ON public.campaigns;
CREATE POLICY "campaigns_select" ON public.campaigns FOR SELECT
  USING (
    public.has_universe_role(universe_id, ARRAY['owner'])
    OR public.is_campaign_member(id)
  );

-- campaign_members_* : remplace le EXISTS(campaigns) brut
DROP POLICY IF EXISTS "campaign_members_select" ON public.campaign_members;
CREATE POLICY "campaign_members_select" ON public.campaign_members FOR SELECT
  USING (
    user_id = auth.uid()
    OR public.is_campaign_universe_owner(campaign_id)
  );

DROP POLICY IF EXISTS "campaign_members_insert_owner" ON public.campaign_members;
CREATE POLICY "campaign_members_insert_owner" ON public.campaign_members FOR INSERT
  WITH CHECK (public.is_campaign_universe_owner(campaign_id));

DROP POLICY IF EXISTS "campaign_members_delete_owner" ON public.campaign_members;
CREATE POLICY "campaign_members_delete_owner" ON public.campaign_members FOR DELETE
  USING (public.is_campaign_universe_owner(campaign_id));
