-- ══════════════════════════════════════════════════════════════
-- Camply — Panneau d'administration : statistiques utilisateurs
-- À coller dans : Supabase Dashboard > SQL Editor > New query
-- Nécessite sql/30_admin_panel.sql déjà appliqué.
--
-- Ajoute à admin_get_stats() un bloc "users" :
--   - total     : nombre total de comptes (auth.users)
--   - active_30d : comptes connectés au moins une fois dans les 30
--     derniers jours (auth.users.last_sign_in_at, renseigné par
--     Supabase Auth à chaque connexion — aucune table de suivi
--     supplémentaire nécessaire).
-- ══════════════════════════════════════════════════════════════

BEGIN;

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
  v_users_total      BIGINT;
  v_users_active     BIGINT;
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

  SELECT count(*),
         count(*) FILTER (WHERE last_sign_in_at >= now() - interval '30 days')
    INTO v_users_total, v_users_active
    FROM auth.users;

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
    'users', jsonb_build_object(
      'total',     v_users_total,
      'active_30d', v_users_active
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

COMMIT;
