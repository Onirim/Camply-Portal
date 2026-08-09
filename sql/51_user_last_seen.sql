-- ══════════════════════════════════════════════════════════════
-- Camply — Suivi de la dernière visite d'un utilisateur
-- À exécuter après sql/50_admin_user_status.sql.
--
-- profiles.last_seen_at enregistre chaque chargement authentifié de
-- Camply. Pour les comptes qui n'ont pas encore revisité le site après
-- cette migration, les indicateurs admin se replient temporairement sur
-- auth.users.last_sign_in_at.
-- ══════════════════════════════════════════════════════════════

BEGIN;

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS last_seen_at TIMESTAMPTZ;

COMMENT ON COLUMN public.profiles.last_seen_at IS
  'Dernier chargement authentifié de Camply pour cet utilisateur.';


-- L'heure est fixée côté serveur afin que le client ne fournisse jamais
-- lui-même la valeur enregistrée.
CREATE OR REPLACE FUNCTION public.touch_user_visit(p_username TEXT)
RETURNS TIMESTAMPTZ
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

  INSERT INTO public.profiles (id, username, last_seen_at)
  VALUES (auth.uid(), p_username, v_seen_at)
  ON CONFLICT (id) DO UPDATE
  SET username = EXCLUDED.username,
      last_seen_at = EXCLUDED.last_seen_at;

  RETURN v_seen_at;
END;
$$;

REVOKE ALL ON FUNCTION public.touch_user_visit(TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.touch_user_visit(TEXT) TO authenticated;


-- Les profils sont lisibles entre utilisateurs pour afficher les
-- pseudonymes. Restreindre les privilèges de colonnes évite d'exposer les
-- horodatages privés ajoutés au profil (last_seen_at, last_seen_news_at).
REVOKE SELECT, INSERT, UPDATE, DELETE ON public.profiles FROM anon, authenticated;
GRANT SELECT (id, username) ON public.profiles TO anon;
GRANT SELECT (id, username, max_universes) ON public.profiles TO authenticated;


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
         count(*) FILTER (
           WHERE COALESCE(p.last_seen_at, au.last_sign_in_at) >= now() - interval '30 days'
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

REVOKE EXECUTE ON FUNCTION public.admin_get_stats() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_get_stats() TO authenticated;


DROP FUNCTION IF EXISTS public.admin_list_users();

CREATE FUNCTION public.admin_list_users()
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
    COALESCE(
      COALESCE(p.last_seen_at, au.last_sign_in_at) >= now() - interval '30 days',
      FALSE
    )
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

REVOKE EXECUTE ON FUNCTION public.admin_list_users() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_list_users() TO authenticated;

COMMIT;
