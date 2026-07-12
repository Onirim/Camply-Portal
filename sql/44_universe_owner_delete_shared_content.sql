-- ══════════════════════════════════════════════════════════════
-- Camply Portal — Droit de suppression MJ/propriétaire sur le
-- contenu public partagé de son univers.
--
-- Constat : les policies UPDATE de characters, chronicles,
-- chronicle_entries, documents et map_layers ont été enrichies
-- (sql/00 + migrations suivantes) pour autoriser un MJ/propriétaire
-- d'univers (can_gm_edit) à éditer un objet public appartenant à un
-- autre joueur avec qui il partage une campagne. Les policies DELETE
-- correspondantes n'ont jamais reçu la même extension et sont
-- restées strictement limitées au propriétaire de la ligne
-- (auth.uid() = user_id), ce qui empêchait un MJ/propriétaire de
-- supprimer un élément partagé qu'il pouvait pourtant éditer.
--
-- map_markers n'est pas concerné : sa policy "map_markers_all_own"
-- est déjà FOR ALL et couvre donc DELETE via can_gm_edit.
-- ══════════════════════════════════════════════════════════════

BEGIN;

-- Personnages
DROP POLICY IF EXISTS "characters_delete" ON public.characters;
CREATE POLICY "characters_delete" ON public.characters FOR DELETE
  USING (
    auth.uid() = user_id
    OR (is_public = TRUE AND public.can_gm_edit(universe_id, user_id, auth.uid()))
  );

-- Chroniques
DROP POLICY IF EXISTS "chronicles_delete" ON public.chronicles;
CREATE POLICY "chronicles_delete" ON public.chronicles FOR DELETE
  USING (
    auth.uid() = user_id
    OR (is_public = TRUE AND public.can_gm_edit(universe_id, user_id, auth.uid()))
  );

-- Entrées de chronique
DROP POLICY IF EXISTS "entries_delete" ON public.chronicle_entries;
CREATE POLICY "entries_delete" ON public.chronicle_entries FOR DELETE
  USING (EXISTS (
    SELECT 1 FROM public.chronicles c
    WHERE c.id = chronicle_entries.chronicle_id
      AND (
        c.user_id = auth.uid()
        OR (c.is_public = TRUE AND public.can_gm_edit(c.universe_id, c.user_id, auth.uid()))
      )
  ));

-- Documents
DROP POLICY IF EXISTS "documents_delete" ON public.documents;
CREATE POLICY "documents_delete" ON public.documents FOR DELETE
  USING (
    auth.uid() = user_id
    OR (is_public = TRUE AND public.can_gm_edit(universe_id, user_id, auth.uid()))
  );

-- Couches de carte
DROP POLICY IF EXISTS "map_layers_delete" ON public.map_layers;
CREATE POLICY "map_layers_delete" ON public.map_layers FOR DELETE
  USING (
    auth.uid() = user_id
    OR (is_public = TRUE AND public.can_gm_edit(universe_id, user_id, auth.uid()))
  );

COMMIT;

-- ══════════════════════════════════════════════════════════════
-- Fin.
-- ══════════════════════════════════════════════════════════════
