-- ══════════════════════════════════════════════════════════════
-- Camply Portal — Correctif : verrou circulaire sur la curation
-- des objets publics par campagne (introduit par sql/35)
-- À exécuter sur une base ayant déjà reçu sql/35_campaign_gm_management.sql.
--
-- Constat : depuis sql/35, dès qu'au moins une campagne existe dans
-- un univers, un objet public (personnage, chronique, document,
-- carte) n'est visible aux autres membres que s'il a été coché dans
-- campaign_visible_* pour une campagne commune. Mais le sélecteur de
-- curation (campaigns.js: loadPublicObjectOptions) interroge les
-- tables characters/chronicles/documents/map_layers avec un simple
-- SELECT, soumis à la même policy RLS restrictive.
--
-- Résultat : un objet public créé par un simple joueur (ni owner ni
-- gm) après la création d'une première campagne dans l'univers
-- devient invisible pour tout le monde, y compris pour le MJ et le
-- propriétaire de l'univers — qui n'ont donc physiquement aucun
-- moyen de le voir pour le cocher dans campaign_visible_*. Verrou
-- circulaire : il faudrait qu'il soit déjà coché pour pouvoir le
-- voir et le cocher.
--
-- Correctif : le propriétaire et le MJ de l'univers doivent pouvoir
-- voir tout objet public de leur univers, indépendamment de la
-- curation par campagne — exactement comme campaigns_select leur
-- donne déjà une vue complète des campagnes via has_universe_role.
-- ══════════════════════════════════════════════════════════════

BEGIN;

-- Personnages
DROP POLICY IF EXISTS "characters_select" ON public.characters;
CREATE POLICY "characters_select" ON public.characters FOR SELECT
  USING (
    auth.uid() = user_id
    OR (
      is_public = TRUE
      AND (
        public.has_universe_role(universe_id, ARRAY['owner', 'gm'])
        OR (
          public.shares_campaign_with(universe_id, user_id, auth.uid())
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
      AND (
        public.has_universe_role(universe_id, ARRAY['owner', 'gm'])
        OR (
          public.shares_campaign_with(universe_id, user_id, auth.uid())
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
      )
    )
  );

-- Documents
DROP POLICY IF EXISTS "documents_select" ON public.documents;
CREATE POLICY "documents_select" ON public.documents FOR SELECT
  USING (
    auth.uid() = user_id
    OR (
      is_public = TRUE
      AND (
        public.has_universe_role(universe_id, ARRAY['owner', 'gm'])
        OR (
          public.shares_campaign_with(universe_id, user_id, auth.uid())
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
      )
    )
  );

-- Couches de carte
DROP POLICY IF EXISTS "map_layers_select" ON public.map_layers;
CREATE POLICY "map_layers_select" ON public.map_layers FOR SELECT
  USING (
    auth.uid() = user_id
    OR (
      is_public = TRUE
      AND (
        public.has_universe_role(universe_id, ARRAY['owner', 'gm'])
        OR (
          public.shares_campaign_with(universe_id, user_id, auth.uid())
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
        AND (
          public.has_universe_role(ml.universe_id, ARRAY['owner', 'gm'])
          OR (
            public.shares_campaign_with(ml.universe_id, ml.user_id, auth.uid())
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
        )
    )
  );

COMMIT;

-- ══════════════════════════════════════════════════════════════
-- Fin — voir campaigns.js (loadPublicObjectOptions) pour la partie
-- frontend qui dépendait de ce correctif.
-- ══════════════════════════════════════════════════════════════
