-- =============================================================
-- Camply — Fiabilisation du suivi d'activité utilisateur
-- À exécuter après sql/51_user_last_seen.sql.
--
-- 1. Rattrape l'historique disponible dans Auth (connexion + session).
-- 2. Les anciens clients qui ouvrent un univers mettent aussi à jour
--    profiles.last_seen_at, sans dépendre du nouveau JavaScript.
-- 3. Le panneau admin utilise ensuite exclusivement last_seen_at.
-- =============================================================

BEGIN;


-- Rattrapage ponctuel : on conserve la date la plus récente connue.
-- auth.sessions n'est volontairement utilisée qu'ici, lors de la migration ;
-- le suivi courant repose ensuite sur les RPC applicatives.
WITH auth_activity AS (
  SELECT
    au.id,
    NULLIF(
      GREATEST(
        COALESCE(au.last_sign_in_at, '-infinity'::timestamptz),
        COALESCE(MAX(s.updated_at), '-infinity'::timestamptz)
      ),
      '-infinity'::timestamptz
    ) AS seen_at
  FROM auth.users au
  LEFT JOIN auth.sessions s ON s.user_id = au.id
  GROUP BY au.id, au.last_sign_in_at
)
UPDATE public.profiles p
SET last_seen_at = CASE
  WHEN p.last_seen_at IS NULL THEN a.seen_at
  ELSE GREATEST(p.last_seen_at, a.seen_at)
END
FROM auth_activity a
WHERE a.id = p.id
  AND a.seen_at IS NOT NULL
  AND (p.last_seen_at IS NULL OR p.last_seen_at < a.seen_at);


CREATE OR REPLACE FUNCTION public.touch_universe_visit(p_universe_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_seen_at TIMESTAMPTZ := clock_timestamp();
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;

  IF NOT public.is_universe_member(p_universe_id, auth.uid()) THEN
    RAISE EXCEPTION 'Seuls les membres de l''univers peuvent enregistrer une visite';
  END IF;

  UPDATE public.universes
  SET last_visited_at = v_seen_at
  WHERE id = p_universe_id;

  UPDATE public.profiles
  SET last_seen_at = v_seen_at
  WHERE id = auth.uid();
END;
$$;

REVOKE ALL ON FUNCTION public.touch_universe_visit(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.touch_universe_visit(UUID) TO authenticated;


CREATE OR REPLACE FUNCTION public.admin_get_stats()
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
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
         count(*) FILTER (
           WHERE p.last_seen_at >= now() - interval '30 days'
         )
    INTO v_users_total, v_users_active
    FROM auth.users au
    LEFT JOIN public.profiles p ON p.id = au.id;

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
      'total',      v_users_total,
      'active_30d', v_users_active
    ),
    'orphans', jsonb_build_object(
      'count', v_orphan_count,
      'bytes', v_orphan_bytes
    ),
    'storage', jsonb_build_object(
      'bytes',       v_storage_bytes,
      'limit_bytes', 1073741824
    ),
    'database', jsonb_build_object(
      'bytes',       v_db_bytes,
      'limit_bytes', 524288000
    )
  );
END;
$$;

REVOKE ALL ON FUNCTION public.admin_get_stats() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_get_stats() TO authenticated;


CREATE OR REPLACE FUNCTION public.admin_list_users()
RETURNS TABLE(
  user_id         UUID,
  username        TEXT,
  email           TEXT,
  max_universes   INT,
  owned_universes BIGINT,
  objects_count   BIGINT,
  created_at      TIMESTAMPTZ,
  last_seen_at    TIMESTAMPTZ,
  is_active       BOOLEAN
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'Accès réservé aux administrateurs';
  END IF;

  RETURN QUERY
  SELECT
    p.id,
    p.username,
    au.email::text,
    p.max_universes,
    COALESCE(uc.owned_count, 0),
    COALESCE(oc.total, 0),
    au.created_at,
    p.last_seen_at,
    COALESCE(p.last_seen_at >= now() - interval '30 days', FALSE)
  FROM public.profiles p
  JOIN auth.users au ON au.id = p.id
  LEFT JOIN (
    SELECT un.owner_id AS oid, count(*) AS owned_count
    FROM public.universes un
    GROUP BY un.owner_id
  ) uc ON uc.oid = p.id
  LEFT JOIN (
    SELECT t.uid, count(*) AS total FROM (
      SELECT c.user_id  AS uid FROM public.characters c
      UNION ALL SELECT ch.user_id AS uid FROM public.chronicles ch
      UNION ALL SELECT d.user_id  AS uid FROM public.documents d
      UNION ALL SELECT cp.user_id AS uid FROM public.campaigns cp
      UNION ALL SELECT m.created_by AS uid FROM public.maps m
    ) t
    GROUP BY t.uid
  ) oc ON oc.uid = p.id
  ORDER BY au.created_at;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_list_users() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_list_users() TO authenticated;

COMMIT;
