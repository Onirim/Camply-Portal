-- ══════════════════════════════════════════════════════════════
-- CAMPLY — Corrections stockage des illustrations (orphelins)
-- À exécuter sur une base ayant déjà reçu sql/00_fresh_install.sql
-- (jusqu'à sql/27_map_markers_linked_object.sql inclus).
--
-- Ce script corrige trois problèmes découverts lors de l'audit
-- pré-stable :
--
-- 1. delete_universe() référence public.characters.illustration_url,
--    qui n'existe pas (l'URL est dans la colonne jsonb `data`). La
--    fonction levait systématiquement une erreur 42703 : la
--    suppression d'un univers échouait à 100 %.
--
-- 2. Les policies RLS de update/delete sur le bucket
--    character-illustrations exigeaient que le 1er segment du
--    chemin (le dossier) soit égal à auth.uid(). Or transfer_item()
--    et remove_universe_member() changent le propriétaire (user_id)
--    d'un personnage/document/chronique en base SANS déplacer le
--    fichier associé. Le nouvel propriétaire ne pouvait donc plus
--    jamais remplacer ni supprimer l'image existante (RLS refusée,
--    échec silencieux côté client car deleteStorageFile() n'inspecte
--    pas l'erreur retournée) → fuite garantie à chaque transfert.
--
-- 3. is_orphan_illustration() et list_orphan_illustrations()
--    existaient déjà en base de production mais dans aucun fichier
--    de migration versionné : elles auraient disparu à la moindre
--    reconstruction depuis sql/00_fresh_install.sql. Elles sont
--    reprises ici à l'identique (aucun changement de comportement),
--    et servent désormais aussi de garde-fou serveur pour le nettoyage
--    manuel des orphelins (cf. point 2 ci-dessous).
--
-- Rappel important : la suppression réelle d'un objet de Storage doit
-- TOUJOURS passer par l'API Storage (sb.storage.from(bucket).remove(...)
-- côté client). Un DELETE SQL direct sur storage.objects est bloqué par
-- Supabase (trigger storage.protect_delete) précisément pour éviter de
-- laisser les fichiers binaires orphelins côté S3 même si la ligne de
-- métadonnées disparaît. Ce script ne fait donc que corriger qui a le
-- droit d'appeler l'API Storage, jamais des DELETE directs.
-- ══════════════════════════════════════════════════════════════

BEGIN;

-- ── 1. Fix delete_universe() ────────────────────────────────────
-- Les personnages stockent leur illustration dans data->>'illustration_url',
-- pas dans une colonne dédiée.
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


-- ── 2. Détection des illustrations orphelines ───────────────────
-- Reprise à l'identique des fonctions déjà présentes en production
-- (non versionnées jusqu'ici) : un fichier est orphelin si aucune
-- ligne de universes/characters/chronicles/documents/maps ne pointe
-- vers lui.
CREATE OR REPLACE FUNCTION public.is_orphan_illustration(p_bucket_id TEXT, p_name TEXT)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT CASE p_bucket_id
    WHEN 'character-illustrations' THEN
      NOT EXISTS (SELECT 1 FROM public.characters  c WHERE (c.data->>'illustration_url') LIKE '%' || p_name || '%')
      AND NOT EXISTS (SELECT 1 FROM public.chronicles c WHERE c.illustration_url LIKE '%' || p_name || '%')
      AND NOT EXISTS (SELECT 1 FROM public.documents  d WHERE d.illustration_url LIKE '%' || p_name || '%')
      AND NOT EXISTS (SELECT 1 FROM public.universes  u WHERE u.illustration_url LIKE '%' || p_name || '%')
    WHEN 'map-images' THEN
      NOT EXISTS (SELECT 1 FROM public.maps m WHERE m.image_url LIKE '%' || p_name || '%')
    ELSE FALSE
  END;
$$;

GRANT EXECUTE ON FUNCTION public.is_orphan_illustration(TEXT, TEXT) TO authenticated;

-- Liste les fichiers orphelins des deux buckets d'illustrations.
-- Réservé aux personnes possédant au moins un univers (évite qu'un
-- compte fraîchement créé puisse lister les noms de fichiers de
-- tout le monde).
CREATE OR REPLACE FUNCTION public.list_orphan_illustrations()
RETURNS TABLE(bucket_id TEXT, path TEXT, size_bytes BIGINT)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.universes u WHERE u.owner_id = auth.uid()) THEN
    RAISE EXCEPTION 'Seuls les propriétaires d''univers peuvent lister les fichiers orphelins.';
  END IF;

  RETURN QUERY
  SELECT o.bucket_id, o.name, (o.metadata->>'size')::bigint
  FROM storage.objects o
  WHERE o.bucket_id IN ('character-illustrations', 'map-images')
    AND public.is_orphan_illustration(o.bucket_id, o.name);
END;
$$;

GRANT EXECUTE ON FUNCTION public.list_orphan_illustrations() TO authenticated;


-- ── 3. RLS update/delete dynamique sur character-illustrations ──
-- Remplace la vérification statique "dossier == auth.uid()" par une
-- vérification à 3 niveaux :
--   a) dossier == auth.uid()            → comportement historique,
--      cas normal (pas de transfert).
--   b) propriété actuelle en base       → couvre le cas d'un
--      personnage/document/chronique/univers transféré à un autre
--      utilisateur (transfer_item / remove_universe_member) : le
--      nouveau propriétaire peut désormais remplacer ou supprimer
--      l'image même si elle est restée dans le dossier de l'ancien
--      propriétaire.
--   c) fichier confirmé orphelin        → n'importe quel utilisateur
--      connecté peut nettoyer un fichier dont is_orphan_illustration()
--      prouve côté serveur qu'il n'est référencé par rien. Un fichier
--      réellement utilisé ne peut jamais matcher cette clause.
CREATE OR REPLACE FUNCTION public.storage_can_manage_illustration(p_bucket_id TEXT, p_name TEXT)
RETURNS BOOLEAN
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_folder TEXT := (storage.foldername(p_name))[1];
  v_file   TEXT := split_part(p_name, '/', 2);
  v_id     UUID;
BEGIN
  IF v_folder = auth.uid()::text THEN
    RETURN TRUE;
  END IF;

  IF p_bucket_id = 'character-illustrations' THEN
    BEGIN
      v_id := (regexp_match(v_file, '^(?:doc_|chr_|universe_)?([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})'))[1]::uuid;
    EXCEPTION WHEN OTHERS THEN
      v_id := NULL;
    END;

    IF v_id IS NOT NULL AND (
      EXISTS (SELECT 1 FROM public.characters WHERE id = v_id AND user_id = auth.uid())
      OR EXISTS (SELECT 1 FROM public.documents  WHERE id = v_id AND user_id = auth.uid())
      OR EXISTS (SELECT 1 FROM public.chronicles WHERE id = v_id AND user_id = auth.uid())
      OR EXISTS (SELECT 1 FROM public.universes  WHERE id = v_id AND owner_id = auth.uid())
    ) THEN
      RETURN TRUE;
    END IF;
  END IF;

  RETURN public.is_orphan_illustration(p_bucket_id, p_name);
END;
$$;

GRANT EXECUTE ON FUNCTION public.storage_can_manage_illustration(TEXT, TEXT) TO authenticated;

DROP POLICY IF EXISTS "illustrations_update_own" ON storage.objects;
CREATE POLICY "illustrations_update_own"
  ON storage.objects FOR UPDATE
  TO authenticated
  USING (
    bucket_id = 'character-illustrations'
    AND public.storage_can_manage_illustration(bucket_id, name)
  );

DROP POLICY IF EXISTS "illustrations_delete_own" ON storage.objects;
CREATE POLICY "illustrations_delete_own"
  ON storage.objects FOR DELETE
  TO authenticated
  USING (
    bucket_id = 'character-illustrations'
    AND public.storage_can_manage_illustration(bucket_id, name)
  );

-- Une policy "illustrations_delete_orphan_by_any_owner" existait déjà
-- (créée hors migration, cf. point 3 de l'en-tête) et n'autorisait le
-- nettoyage d'orphelins qu'aux propriétaires d'univers. Elle est
-- strictement subsumée par illustrations_delete_own ci-dessus (qui
-- couvre aussi le cas "orphelin" sans cette restriction) : on la
-- retire pour ne garder qu'une seule policy DELETE à lire.
DROP POLICY IF EXISTS "illustrations_delete_orphan_by_any_owner" ON storage.objects;

-- Idem côté map-images : la policy existait déjà hors migration. Elle
-- reste utile ici car storage_path_universe_role() exige d'être owner
-- DE CET UNIVERS précis, alors que celle-ci permet à N'IMPORTE QUEL
-- owner d'univers de nettoyer un fichier confirmé orphelin même dans
-- le dossier d'un autre univers (utile si un univers a été supprimé
-- par un autre biais que delete_universe()). On la reprend telle
-- quelle pour la verser en migration.
DROP POLICY IF EXISTS "map_images_delete_orphan_by_any_owner" ON storage.objects;
CREATE POLICY "map_images_delete_orphan_by_any_owner"
  ON storage.objects FOR DELETE
  TO authenticated
  USING (
    bucket_id = 'map-images'
    AND EXISTS (SELECT 1 FROM public.universes u WHERE u.owner_id = auth.uid())
    AND public.is_orphan_illustration(bucket_id, name)
  );

COMMIT;

-- ══════════════════════════════════════════════════════════════
-- Résumé :
--  • delete_universe() ne référence plus une colonne inexistante :
--    la suppression d'univers fonctionne à nouveau.
--  • is_orphan_illustration() / list_orphan_illustrations() sont
--    désormais versionnées (elles existaient déjà en prod, ajoutées
--    hors migration).
--  • storage_can_manage_illustration() : après un transfert de
--    personnage/document/chronique/univers, le nouveau propriétaire
--    peut gérer l'illustration existante. N'importe quel utilisateur
--    connecté peut supprimer un fichier confirmé orphelin (vérifié
--    côté serveur, jamais sur la seule confiance du client).
--  • Aucun changement fonctionnel côté map-images : sa policy de
--    remplacement/suppression normale vérifie déjà le rôle courant
--    sur l'univers (storage_path_universe_role), pas un propriétaire
--    figé au moment de l'upload — elle ne souffre pas de ce bug.
--    Sa policy de nettoyage d'orphelins (map_images_delete_orphan_by_any_owner)
--    est simplement reprise à l'identique pour être versionnée.
--  • illustrations_delete_orphan_by_any_owner (character-illustrations)
--    est supprimée : redondante avec illustrations_delete_own qui
--    couvre déjà, plus largement, le nettoyage des orphelins.
--  • Rappel : le nettoyage réel des fichiers doit se faire via
--    sb.storage.from(bucket).remove([...]) côté client (ou tout appel
--    à l'API Storage), jamais via un DELETE SQL direct (bloqué par
--    Supabase de toute façon).
-- ══════════════════════════════════════════════════════════════
