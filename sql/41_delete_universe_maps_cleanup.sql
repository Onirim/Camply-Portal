-- ══════════════════════════════════════════════════════════════
-- Camply Portal — Correctif : cartes oubliées à la suppression d'un univers
--
-- delete_universe() renvoie les illustration_url à nettoyer côté
-- storage (universes, characters, chronicles, documents) mais
-- oubliait les image_url de la table maps. Le nettoyage des cartes
-- reposait donc uniquement sur un sb.storage.list()+remove() côté
-- client, lancé après coup et jamais attendu (fire-and-forget) :
-- en cas d'échec réseau ou de fermeture d'onglet juste après la
-- suppression, les fichiers du bucket map-images restaient orphelins
-- sans qu'aucune erreur ne soit visible (cf. sql/28 is_orphan_illustration
-- et admin_list_orphan_illustrations qui les détectent après coup).
-- ══════════════════════════════════════════════════════════════

BEGIN;

CREATE OR REPLACE FUNCTION public.delete_universe(p_universe_id UUID)
RETURNS TEXT[]
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_owner UUID;
  v_urls  TEXT[];
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;

  SELECT owner_id INTO v_owner
  FROM public.universes
  WHERE id = p_universe_id;

  IF v_owner IS NULL THEN
    RAISE EXCEPTION 'Univers introuvable';
  END IF;

  IF v_owner != auth.uid() THEN
    RAISE EXCEPTION 'Seul le propriétaire peut supprimer cet univers';
  END IF;

  -- Collecte les URLs d'illustration de tout l'univers (y compris les
  -- éléments privés créés par d'autres membres, invisibles via les
  -- policies RLS SELECT habituelles) pour nettoyage du storage côté client.
  SELECT COALESCE(array_agg(url), ARRAY[]::TEXT[]) INTO v_urls
  FROM (
    SELECT illustration_url AS url FROM public.universes  WHERE id = p_universe_id AND illustration_url <> ''
    UNION ALL
    SELECT (data->>'illustration_url') FROM public.characters WHERE universe_id = p_universe_id AND (data->>'illustration_url') IS NOT NULL AND (data->>'illustration_url') <> ''
    UNION ALL
    SELECT illustration_url FROM public.chronicles WHERE universe_id = p_universe_id AND illustration_url <> ''
    UNION ALL
    SELECT illustration_url FROM public.documents  WHERE universe_id = p_universe_id AND illustration_url <> ''
    UNION ALL
    SELECT image_url FROM public.maps WHERE universe_id = p_universe_id AND image_url <> ''
  ) t;

  -- SECURITY DEFINER : le cascade delete ci-dessous doit purger toutes les
  -- données de l'univers (personnages, chroniques, documents, campagnes,
  -- cartes...) même celles créées par d'autres membres, dont les policies
  -- RLS individuelles (auth.uid() = user_id) ne laisseraient pas le
  -- propriétaire de l'univers les supprimer directement.
  DELETE FROM public.universes WHERE id = p_universe_id;

  RETURN v_urls;
END;
$$;

GRANT EXECUTE ON FUNCTION public.delete_universe(UUID) TO authenticated;

-- Même correctif pour la suppression d'univers depuis le panneau admin.
CREATE OR REPLACE FUNCTION public.admin_delete_universe(p_universe_id UUID)
RETURNS TEXT[]
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_urls TEXT[];
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'Accès réservé aux administrateurs';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.universes WHERE id = p_universe_id) THEN
    RAISE EXCEPTION 'Univers introuvable';
  END IF;

  SELECT COALESCE(array_agg(url), ARRAY[]::TEXT[]) INTO v_urls
  FROM (
    SELECT illustration_url AS url FROM public.universes  WHERE id = p_universe_id AND illustration_url <> ''
    UNION ALL
    SELECT (data->>'illustration_url') FROM public.characters WHERE universe_id = p_universe_id AND (data->>'illustration_url') IS NOT NULL AND (data->>'illustration_url') <> ''
    UNION ALL
    SELECT illustration_url FROM public.chronicles WHERE universe_id = p_universe_id AND illustration_url <> ''
    UNION ALL
    SELECT illustration_url FROM public.documents  WHERE universe_id = p_universe_id AND illustration_url <> ''
    UNION ALL
    SELECT image_url FROM public.maps WHERE universe_id = p_universe_id AND image_url <> ''
  ) t;

  DELETE FROM public.universes WHERE id = p_universe_id;

  RETURN v_urls;
END;
$$;

GRANT EXECUTE ON FUNCTION public.admin_delete_universe(UUID) TO authenticated;

COMMIT;
