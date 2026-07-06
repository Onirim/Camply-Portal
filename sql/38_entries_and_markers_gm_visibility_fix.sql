-- ══════════════════════════════════════════════════════════════
-- Camply Portal — Correctif : propagation manquante du bypass
-- MJ/propriétaire (sql/37) sur les entrées de chronique et les
-- marqueurs de carte.
-- À exécuter sur une base ayant déjà reçu sql/37_gm_owner_curation_visibility_fix.sql.
--
-- Constat : sql/37 a ajouté un bypass permettant au MJ/propriétaire
-- de voir tout objet public de son univers, indépendamment de la
-- curation par campagne — mais seulement sur characters, chronicles,
-- documents et map_layers.
--
-- Deux policies dérivées n'ont pas reçu ce bypass, alors qu'elles
-- réimplémentent leur propre copie de la même logique de visibilité
-- au lieu de simplement suivre celle de leur table parente :
--   - chronicle_entries.entries_select (dérivée de chronicles)
--   - map_markers.map_markers_select_shared (dérivée de map_layers)
--
-- Résultat : une chronique redevenue visible pour le MJ/propriétaire
-- grâce à sql/37 pouvait rester vide côté entrées, tant qu'elle
-- n'était pas explicitement curée pour une campagne — même incohérence
-- pour les marqueurs d'une couche de carte publique.
-- ══════════════════════════════════════════════════════════════

BEGIN;

-- Entrées de chronique
DROP POLICY IF EXISTS "entries_select" ON public.chronicle_entries;
CREATE POLICY "entries_select" ON public.chronicle_entries FOR SELECT
  USING (EXISTS (
    SELECT 1 FROM public.chronicles c
    WHERE c.id = chronicle_entries.chronicle_id
      AND (
        c.user_id = auth.uid()
        OR (
          c.is_public = TRUE
          AND (
            public.has_universe_role(c.universe_id, ARRAY['owner', 'gm'])
            OR (
              public.shares_campaign_with(c.universe_id, c.user_id, auth.uid())
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
        )
      )
  ));

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
-- Fin.
-- ══════════════════════════════════════════════════════════════
