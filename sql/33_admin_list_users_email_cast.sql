-- ══════════════════════════════════════════════════════════════
-- Camply — Correctif : admin_list_users() (type email)
-- À coller dans : Supabase Dashboard > SQL Editor > New query
-- Nécessite sql/32_admin_list_ambiguous_fix.sql déjà appliqué.
--
-- Bug : auth.users.email est de type character varying(255), pas
-- text. RETURN QUERY exige une correspondance exacte de type avec la
-- colonne déclarée dans RETURNS TABLE(..., email TEXT, ...), sinon
-- Postgres lève "structure of query does not match function result
-- type" (erreur 400 côté client, visible seulement à l'exécution).
-- Correctif : cast explicite au.email::text.
-- ══════════════════════════════════════════════════════════════

BEGIN;

CREATE OR REPLACE FUNCTION public.admin_list_users()
RETURNS TABLE(
  user_id         UUID,
  username        TEXT,
  email           TEXT,
  max_universes   INT,
  owned_universes BIGINT,
  objects_count   BIGINT,
  created_at      TIMESTAMPTZ
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
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
    au.created_at
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

GRANT EXECUTE ON FUNCTION public.admin_list_users() TO authenticated;

COMMIT;
