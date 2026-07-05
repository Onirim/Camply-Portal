-- ══════════════════════════════════════════════════════════════
-- Camply Portal — Correctif : gestion de campagnes par le MJ
-- À exécuter sur une base ayant déjà reçu sql/00_fresh_install.sql
-- (et idéalement sql/24 à sql/34).
--
-- Trois correctifs demandés sur la gestion de campagnes :
--
-- 1. Liste des membres : un simple membre (joueur ou MJ) ne voyait
--    que sa propre ligne dans campaign_members (policy restreinte au
--    propriétaire de l'univers). Un membre de la campagne doit voir
--    tous les autres membres.
--
-- 2. Création/édition de campagne : réservée au propriétaire de
--    l'univers côté frontend (campaigns.js) ET côté RLS. Le MJ doit
--    pouvoir créer/modifier/supprimer des campagnes et gérer leurs
--    membres/objets visibles au même titre que le propriétaire.
--
-- 3. Partage d'éléments publics : le sélecteur d'objets visibles par
--    campagne (campaign_visible_characters/chronicles/documents/maps)
--    ne proposait que les objets publics créés par un membre
--    owner/gm — les personnages publics des simples joueurs (ex.
--    Amber Reynolds, Zezette) n'apparaissaient jamais dans le
--    sélecteur, et étaient de toute façon auto-partagés à toute la
--    campagne sans possibilité de curation (cf. gm_owns_and_restricted
--    qui ne s'appliquait qu'aux objets owner/gm). On passe à une
--    curation explicite pour tout le monde : tout élément public
--    doit être coché pour une campagne donnée dès qu'au moins une
--    campagne existe dans l'univers, quel que soit le rôle de son
--    créateur.
-- ══════════════════════════════════════════════════════════════

-- ── 1. is_campaign_universe_owner : inclut désormais le rôle 'gm' ──
-- Utilisée par campaign_members_select/insert/delete : un MJ gère
-- désormais les membres d'une campagne comme le propriétaire.
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
      AND public.has_universe_role(c.universe_id, ARRAY['owner', 'gm'], p_user_id)
  );
$$;

-- ── 2. campaign_members_select : tout membre de la campagne voit
--       la liste complète de ses co-membres (plus seulement le
--       propriétaire de l'univers).
DROP POLICY IF EXISTS "campaign_members_select" ON public.campaign_members;
CREATE POLICY "campaign_members_select" ON public.campaign_members FOR SELECT
  USING (
    public.is_campaign_member(campaign_id)
    OR public.is_campaign_universe_owner(campaign_id)
  );

-- ── 3. campaigns : le MJ peut créer/modifier/supprimer des campagnes ──
DROP POLICY IF EXISTS "campaigns_select" ON public.campaigns;
CREATE POLICY "campaigns_select" ON public.campaigns FOR SELECT
  USING (
    public.has_universe_role(universe_id, ARRAY['owner', 'gm'])
    OR public.is_campaign_member(id)
  );

DROP POLICY IF EXISTS "campaigns_insert_owner" ON public.campaigns;
CREATE POLICY "campaigns_insert_owner" ON public.campaigns FOR INSERT
  WITH CHECK (
    user_id = auth.uid()
    AND public.has_universe_role(universe_id, ARRAY['owner', 'gm'])
  );

DROP POLICY IF EXISTS "campaigns_update_owner" ON public.campaigns;
CREATE POLICY "campaigns_update_owner" ON public.campaigns FOR UPDATE
  USING (public.has_universe_role(universe_id, ARRAY['owner', 'gm']))
  WITH CHECK (public.has_universe_role(universe_id, ARRAY['owner', 'gm']));

DROP POLICY IF EXISTS "campaigns_delete_owner" ON public.campaigns;
CREATE POLICY "campaigns_delete_owner" ON public.campaigns FOR DELETE
  USING (public.has_universe_role(universe_id, ARRAY['owner', 'gm']));

-- campaign_members_insert_owner / campaign_members_delete_owner
-- réutilisent is_campaign_universe_owner (mise à jour ci-dessus) :
-- rien à changer pour elles, le MJ hérite automatiquement du droit.

-- ── 4. campaign_visible_* : le MJ peut aussi curer la visibilité ──
DROP POLICY IF EXISTS "campaign_visible_characters_select" ON public.campaign_visible_characters;
CREATE POLICY "campaign_visible_characters_select" ON public.campaign_visible_characters FOR SELECT
  USING (
    EXISTS (SELECT 1 FROM public.campaign_members cm WHERE cm.campaign_id = campaign_id AND cm.user_id = auth.uid())
    OR EXISTS (
      SELECT 1 FROM public.campaigns c
      WHERE c.id = campaign_id AND public.has_universe_role(c.universe_id, ARRAY['owner', 'gm'])
    )
  );

DROP POLICY IF EXISTS "campaign_visible_characters_write" ON public.campaign_visible_characters;
CREATE POLICY "campaign_visible_characters_write" ON public.campaign_visible_characters FOR ALL
  USING (EXISTS (
    SELECT 1 FROM public.campaigns c
    WHERE c.id = campaign_id AND public.has_universe_role(c.universe_id, ARRAY['owner', 'gm'])
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM public.campaigns c
    WHERE c.id = campaign_id AND public.has_universe_role(c.universe_id, ARRAY['owner', 'gm'])
  ));

DROP POLICY IF EXISTS "campaign_visible_chronicles_select" ON public.campaign_visible_chronicles;
CREATE POLICY "campaign_visible_chronicles_select" ON public.campaign_visible_chronicles FOR SELECT
  USING (
    EXISTS (SELECT 1 FROM public.campaign_members cm WHERE cm.campaign_id = campaign_id AND cm.user_id = auth.uid())
    OR EXISTS (
      SELECT 1 FROM public.campaigns c
      WHERE c.id = campaign_id AND public.has_universe_role(c.universe_id, ARRAY['owner', 'gm'])
    )
  );

DROP POLICY IF EXISTS "campaign_visible_chronicles_write" ON public.campaign_visible_chronicles;
CREATE POLICY "campaign_visible_chronicles_write" ON public.campaign_visible_chronicles FOR ALL
  USING (EXISTS (
    SELECT 1 FROM public.campaigns c
    WHERE c.id = campaign_id AND public.has_universe_role(c.universe_id, ARRAY['owner', 'gm'])
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM public.campaigns c
    WHERE c.id = campaign_id AND public.has_universe_role(c.universe_id, ARRAY['owner', 'gm'])
  ));

DROP POLICY IF EXISTS "campaign_visible_documents_select" ON public.campaign_visible_documents;
CREATE POLICY "campaign_visible_documents_select" ON public.campaign_visible_documents FOR SELECT
  USING (
    EXISTS (SELECT 1 FROM public.campaign_members cm WHERE cm.campaign_id = campaign_id AND cm.user_id = auth.uid())
    OR EXISTS (
      SELECT 1 FROM public.campaigns c
      WHERE c.id = campaign_id AND public.has_universe_role(c.universe_id, ARRAY['owner', 'gm'])
    )
  );

DROP POLICY IF EXISTS "campaign_visible_documents_write" ON public.campaign_visible_documents;
CREATE POLICY "campaign_visible_documents_write" ON public.campaign_visible_documents FOR ALL
  USING (EXISTS (
    SELECT 1 FROM public.campaigns c
    WHERE c.id = campaign_id AND public.has_universe_role(c.universe_id, ARRAY['owner', 'gm'])
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM public.campaigns c
    WHERE c.id = campaign_id AND public.has_universe_role(c.universe_id, ARRAY['owner', 'gm'])
  ));

DROP POLICY IF EXISTS "campaign_visible_maps_select" ON public.campaign_visible_maps;
CREATE POLICY "campaign_visible_maps_select" ON public.campaign_visible_maps FOR SELECT
  USING (
    EXISTS (SELECT 1 FROM public.campaign_members cm WHERE cm.campaign_id = campaign_id AND cm.user_id = auth.uid())
    OR EXISTS (
      SELECT 1 FROM public.campaigns c
      WHERE c.id = campaign_id AND public.has_universe_role(c.universe_id, ARRAY['owner', 'gm'])
    )
  );

DROP POLICY IF EXISTS "campaign_visible_maps_write" ON public.campaign_visible_maps;
CREATE POLICY "campaign_visible_maps_write" ON public.campaign_visible_maps FOR ALL
  USING (EXISTS (
    SELECT 1 FROM public.campaigns c
    WHERE c.id = campaign_id AND public.has_universe_role(c.universe_id, ARRAY['owner', 'gm'])
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM public.campaigns c
    WHERE c.id = campaign_id AND public.has_universe_role(c.universe_id, ARRAY['owner', 'gm'])
  ));

-- ── 5. Curation explicite pour tout le monde ──────────────────
-- gm_owns_and_restricted ne s'appliquait qu'aux objets créés par un
-- membre owner/gm : les objets des simples joueurs restaient
-- toujours auto-partagés à toute campagne commune, sans possibilité
-- de les restreindre à une campagne précise. On remplace ce
-- comportement par une règle unique : dès qu'au moins une campagne
-- existe dans l'univers, tout élément public doit être explicitement
-- coché pour la campagne concernée (campaign_visible_*), quel que
-- soit le rôle de son créateur.
CREATE OR REPLACE FUNCTION public.campaign_content_restricted(
  p_universe_id UUID
)
RETURNS BOOLEAN
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
  SELECT EXISTS (SELECT 1 FROM public.campaigns c WHERE c.universe_id = p_universe_id);
$$;

GRANT EXECUTE ON FUNCTION public.campaign_content_restricted(UUID) TO authenticated;

-- Personnages
DROP POLICY IF EXISTS "characters_select" ON public.characters;
CREATE POLICY "characters_select" ON public.characters FOR SELECT
  USING (
    auth.uid() = user_id
    OR (
      is_public = TRUE
      AND public.shares_campaign_with(universe_id, user_id, auth.uid())
      AND (
        NOT public.campaign_content_restricted(universe_id)
        OR EXISTS (
          SELECT 1
          FROM public.campaign_members cm
          JOIN public.campaigns c ON c.id = cm.campaign_id
          JOIN public.campaign_visible_characters cvc ON cvc.campaign_id = c.id
          WHERE c.universe_id = characters.universe_id
            AND cm.user_id = auth.uid()
            AND cvc.character_id = characters.id
        )
      )
    )
  );

-- Chroniques
DROP POLICY IF EXISTS "chronicles_select" ON public.chronicles;
CREATE POLICY "chronicles_select" ON public.chronicles FOR SELECT
  USING (
    auth.uid() = user_id
    OR (
      is_public = TRUE
      AND public.shares_campaign_with(universe_id, user_id, auth.uid())
      AND (
        NOT public.campaign_content_restricted(universe_id)
        OR EXISTS (
          SELECT 1
          FROM public.campaign_members cm
          JOIN public.campaigns c ON c.id = cm.campaign_id
          JOIN public.campaign_visible_chronicles cvc ON cvc.campaign_id = c.id
          WHERE c.universe_id = chronicles.universe_id
            AND cm.user_id = auth.uid()
            AND cvc.chronicle_id = chronicles.id
        )
      )
    )
  );

DROP POLICY IF EXISTS "entries_select" ON public.chronicle_entries;
CREATE POLICY "entries_select" ON public.chronicle_entries FOR SELECT
  USING (EXISTS (
    SELECT 1 FROM public.chronicles c
    WHERE c.id = chronicle_id
      AND (
        c.user_id = auth.uid()
        OR (
          c.is_public = TRUE
          AND public.shares_campaign_with(c.universe_id, c.user_id, auth.uid())
          AND (
            NOT public.campaign_content_restricted(c.universe_id)
            OR EXISTS (
              SELECT 1
              FROM public.campaign_members cm
              JOIN public.campaigns cc ON cc.id = cm.campaign_id
              JOIN public.campaign_visible_chronicles cvc ON cvc.campaign_id = cc.id
              WHERE cc.universe_id = c.universe_id
                AND cm.user_id = auth.uid()
                AND cvc.chronicle_id = c.id
            )
          )
        )
      )
  ));

-- Documents
DROP POLICY IF EXISTS "documents_select" ON public.documents;
CREATE POLICY "documents_select" ON public.documents FOR SELECT
  USING (
    auth.uid() = user_id
    OR (
      is_public = TRUE
      AND public.shares_campaign_with(universe_id, user_id, auth.uid())
      AND (
        NOT public.campaign_content_restricted(universe_id)
        OR EXISTS (
          SELECT 1
          FROM public.campaign_members cm
          JOIN public.campaigns c ON c.id = cm.campaign_id
          JOIN public.campaign_visible_documents cvd ON cvd.campaign_id = c.id
          WHERE c.universe_id = documents.universe_id
            AND cm.user_id = auth.uid()
            AND cvd.document_id = documents.id
        )
      )
    )
  );

DROP POLICY IF EXISTS "documents_update" ON public.documents;
CREATE POLICY "documents_update" ON public.documents FOR UPDATE
  USING (
    auth.uid() = user_id
    OR (
      allow_write_share = TRUE
      AND is_public = TRUE
      AND public.shares_campaign_with(universe_id, user_id, auth.uid())
      AND (
        NOT public.campaign_content_restricted(universe_id)
        OR EXISTS (
          SELECT 1
          FROM public.campaign_members cm
          JOIN public.campaigns c ON c.id = cm.campaign_id
          JOIN public.campaign_visible_documents cvd ON cvd.campaign_id = c.id
          WHERE c.universe_id = documents.universe_id
            AND cm.user_id = auth.uid()
            AND cvd.document_id = documents.id
        )
      )
    )
    OR (is_public = TRUE AND public.can_gm_edit(universe_id, user_id, auth.uid()))
  )
  WITH CHECK (
    auth.uid() = user_id
    OR (
      allow_write_share = TRUE
      AND is_public = TRUE
      AND public.shares_campaign_with(universe_id, user_id, auth.uid())
      AND (
        NOT public.campaign_content_restricted(universe_id)
        OR EXISTS (
          SELECT 1
          FROM public.campaign_members cm
          JOIN public.campaigns c ON c.id = cm.campaign_id
          JOIN public.campaign_visible_documents cvd ON cvd.campaign_id = c.id
          WHERE c.universe_id = documents.universe_id
            AND cm.user_id = auth.uid()
            AND cvd.document_id = documents.id
        )
      )
    )
    OR (is_public = TRUE AND public.can_gm_edit(universe_id, user_id, auth.uid()))
  );

-- Couches de carte
DROP POLICY IF EXISTS "map_layers_select" ON public.map_layers;
CREATE POLICY "map_layers_select" ON public.map_layers FOR SELECT
  USING (
    auth.uid() = user_id
    OR (
      is_public = TRUE
      AND public.shares_campaign_with(universe_id, user_id, auth.uid())
      AND (
        NOT public.campaign_content_restricted(universe_id)
        OR EXISTS (
          SELECT 1
          FROM public.campaign_members cm
          JOIN public.campaigns c ON c.id = cm.campaign_id
          JOIN public.campaign_visible_maps cvm ON cvm.campaign_id = c.id
          WHERE c.universe_id = map_layers.universe_id
            AND cm.user_id = auth.uid()
            AND cvm.map_layer_id = map_layers.id
        )
      )
    )
  );

-- Marqueurs de carte
DROP POLICY IF EXISTS "map_markers_select_shared" ON public.map_markers;
CREATE POLICY "map_markers_select_shared" ON public.map_markers FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.map_layers ml
      WHERE ml.user_id  = map_markers.user_id
        AND ml.map_key  = map_markers.map_key
        AND ml.is_public = TRUE
        AND public.shares_campaign_with(ml.universe_id, ml.user_id, auth.uid())
        AND (
          NOT public.campaign_content_restricted(ml.universe_id)
          OR EXISTS (
            SELECT 1
            FROM public.campaign_members cm
            JOIN public.campaigns c ON c.id = cm.campaign_id
            JOIN public.campaign_visible_maps cvm ON cvm.campaign_id = c.id
            WHERE c.universe_id = ml.universe_id
              AND cm.user_id = auth.uid()
              AND cvm.map_layer_id = ml.id
          )
        )
    )
  );

-- L'ancienne fonction n'est plus référencée par aucune policy : on la
-- supprime pour éviter toute confusion avec campaign_content_restricted.
DROP FUNCTION IF EXISTS public.gm_owns_and_restricted(UUID, UUID);

-- ══════════════════════════════════════════════════════════════
-- Fin — voir campaigns.js (loadCampaignMembers, loadGMObjectOptions
-- renommée en loadPublicObjectOptions, isUniverseGM) pour la partie
-- frontend correspondante.
-- ══════════════════════════════════════════════════════════════
