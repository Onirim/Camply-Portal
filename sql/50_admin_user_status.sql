-- ══════════════════════════════════════════════════════════════
-- Camply — Statut d'activité dans la liste des utilisateurs admin
-- À exécuter après sql/49_campaign_export_scope.sql.
--
-- Un compte est considéré actif s'il s'est connecté au moins une fois
-- au cours des 30 derniers jours, comme dans admin_get_stats().
-- ══════════════════════════════════════════════════════════════

BEGIN;

-- Le type de retour change : PostgreSQL impose de supprimer la fonction
-- avant de la recréer.
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
    COALESCE(au.last_sign_in_at >= now() - interval '30 days', FALSE)
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

REVOKE EXECUTE ON FUNCTION public.admin_list_users() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.admin_list_users() FROM anon;
GRANT EXECUTE ON FUNCTION public.admin_list_users() TO authenticated;

COMMIT;
