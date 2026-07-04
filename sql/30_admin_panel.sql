-- ══════════════════════════════════════════════════════════════
-- Camply — Panneau d'administration
-- À coller dans : Supabase Dashboard > SQL Editor > New query
--
-- Ajoute une table admin_users listant les comptes autorisés à
-- accéder au panneau d'administration (statistiques + purge des
-- fichiers orphelins), et les fonctions RPC nécessaires :
--
--   - is_admin()                        : le compte courant est-il admin ?
--   - admin_get_stats()                 : statistiques globales (JSONB)
--   - admin_list_orphan_illustrations() : liste des fichiers orphelins,
--     réservée aux admins (contrairement à list_orphan_illustrations
--     qui exige de posséder un univers, cf. 28_storage_illustrations_fixes.sql)
--
-- admin_users n'a aucune policy RLS : elle n'est lisible que via les
-- fonctions SECURITY DEFINER ci-dessous, jamais directement par les
-- clients (même pattern que universe_archives, cf. 29_universe_pause.sql).
-- ══════════════════════════════════════════════════════════════

BEGIN;

-- ── 1. Table des comptes administrateurs ────────────────────────

CREATE TABLE IF NOT EXISTS public.admin_users (
  user_id    UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE public.admin_users ENABLE ROW LEVEL SECURITY;

-- Bootstrap : compte historique de l'éditeur du projet (onirim.bzh).
INSERT INTO public.admin_users (user_id)
VALUES ('63ec7d72-765d-428d-8c5e-18955d2749d3')
ON CONFLICT DO NOTHING;


-- ── 2. is_admin() ────────────────────────────────────────────────
-- Sans argument : ne renseigne jamais que sur le compte courant, donc
-- sans risque à exposer à tout utilisateur connecté (sert aussi à
-- décider côté client si l'entrée de menu doit être affichée).

CREATE OR REPLACE FUNCTION public.is_admin()
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (SELECT 1 FROM public.admin_users WHERE user_id = auth.uid());
$$;

GRANT EXECUTE ON FUNCTION public.is_admin() TO authenticated;


-- ── 3. Statistiques globales ─────────────────────────────────────

CREATE OR REPLACE FUNCTION public.admin_get_stats()
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_characters       BIGINT;
  v_chronicles       BIGINT;
  v_documents        BIGINT;
  v_campaigns        BIGINT;
  v_maps             BIGINT;
  v_universes_active BIGINT;
  v_universes_paused BIGINT;
  v_storage_bytes    BIGINT;
  v_db_bytes         BIGINT;
  v_orphan_count     BIGINT;
  v_orphan_bytes     BIGINT;
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'Accès réservé aux administrateurs';
  END IF;

  SELECT count(*) INTO v_characters FROM public.characters;
  SELECT count(*) INTO v_chronicles FROM public.chronicles;
  SELECT count(*) INTO v_documents  FROM public.documents;
  SELECT count(*) INTO v_campaigns  FROM public.campaigns;
  SELECT count(*) INTO v_maps       FROM public.maps;

  SELECT count(*) FILTER (WHERE paused_at IS NULL),
         count(*) FILTER (WHERE paused_at IS NOT NULL)
    INTO v_universes_active, v_universes_paused
    FROM public.universes;

  SELECT COALESCE(SUM((o.metadata->>'size')::bigint), 0) INTO v_storage_bytes
  FROM storage.objects o;

  SELECT pg_database_size(current_database()) INTO v_db_bytes;

  SELECT count(*), COALESCE(SUM((o.metadata->>'size')::bigint), 0)
    INTO v_orphan_count, v_orphan_bytes
    FROM storage.objects o
    WHERE o.bucket_id IN ('character-illustrations', 'map-images')
      AND public.is_orphan_illustration(o.bucket_id, o.name);

  RETURN jsonb_build_object(
    'objects', jsonb_build_object(
      'characters', v_characters,
      'chronicles', v_chronicles,
      'documents',  v_documents,
      'campaigns',  v_campaigns,
      'maps',       v_maps,
      'total',      v_characters + v_chronicles + v_documents + v_campaigns + v_maps
    ),
    'universes', jsonb_build_object(
      'active', v_universes_active,
      'paused', v_universes_paused,
      'total',  v_universes_active + v_universes_paused
    ),
    'orphans', jsonb_build_object(
      'count', v_orphan_count,
      'bytes', v_orphan_bytes
    ),
    'storage', jsonb_build_object(
      'bytes',       v_storage_bytes,
      'limit_bytes', 1073741824  -- 1 GB (plan gratuit Supabase)
    ),
    'database', jsonb_build_object(
      'bytes',       v_db_bytes,
      'limit_bytes', 524288000   -- 500 MB (plan gratuit Supabase)
    )
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.admin_get_stats() TO authenticated;


-- ── 4. Liste des orphelins réservée aux admins ──────────────────
-- Identique à list_orphan_illustrations() mais sans l'exigence de
-- posséder un univers : un admin peut ne pas en posséder un.

CREATE OR REPLACE FUNCTION public.admin_list_orphan_illustrations()
RETURNS TABLE(bucket_id TEXT, path TEXT, size_bytes BIGINT)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'Accès réservé aux administrateurs';
  END IF;

  RETURN QUERY
  SELECT o.bucket_id, o.name, (o.metadata->>'size')::bigint
  FROM storage.objects o
  WHERE o.bucket_id IN ('character-illustrations', 'map-images')
    AND public.is_orphan_illustration(o.bucket_id, o.name);
END;
$$;

GRANT EXECUTE ON FUNCTION public.admin_list_orphan_illustrations() TO authenticated;

COMMIT;
