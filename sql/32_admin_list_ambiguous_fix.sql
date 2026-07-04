-- ══════════════════════════════════════════════════════════════
-- Camply — Correctif : admin_list_users()/admin_list_universes()
-- À coller dans : Supabase Dashboard > SQL Editor > New query
-- Nécessite sql/31_admin_users_universes.sql déjà appliqué.
--
-- Bug : RETURNS TABLE(user_id UUID, ...) déclare "user_id" comme
-- variable PL/pgSQL visible dans toute la fonction. Toute référence
-- non qualifiée à une colonne du même nom dans une requête interne
-- (ex : "SELECT user_id FROM public.characters") devient alors
-- ambiguë pour Postgres ("column reference is ambiguous"), même s'il
-- n'y a qu'une seule table candidate. Idem pour "universe_id" dans
-- admin_list_universes(). Le CREATE FUNCTION ne valide pas le corps
-- à la création (seulement à l'exécution), d'où l'échec silencieux
-- côté client (erreur 400) découvert seulement à l'usage.
--
-- Correctif : toutes les colonnes homonymes des paramètres de sortie
-- sont désormais toujours qualifiées par l'alias de leur table
-- source (ex : c.user_id) ou renommées dans les sous-requêtes
-- intermédiaires (ex : AS uid). Aucun changement de comportement ni
-- de forme du résultat.
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
    au.email,
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


CREATE OR REPLACE FUNCTION public.admin_list_universes()
RETURNS TABLE(
  universe_id    UUID,
  name           TEXT,
  owner_id       UUID,
  owner_username TEXT,
  paused_at      TIMESTAMPTZ,
  created_at     TIMESTAMPTZ,
  member_count   BIGINT,
  objects_count  BIGINT
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
    un.id,
    un.name,
    un.owner_id,
    p.username,
    un.paused_at,
    un.created_at,
    COALESCE(mc.member_count, 0),
    COALESCE(oc.total, 0)
  FROM public.universes un
  LEFT JOIN public.profiles p ON p.id = un.owner_id
  LEFT JOIN (
    SELECT um.universe_id AS uwid, count(*) AS member_count
    FROM public.universe_members um
    GROUP BY um.universe_id
  ) mc ON mc.uwid = un.id
  LEFT JOIN (
    SELECT t.uwid, count(*) AS total FROM (
      SELECT c.universe_id  AS uwid FROM public.characters c
      UNION ALL SELECT ch.universe_id AS uwid FROM public.chronicles ch
      UNION ALL SELECT d.universe_id  AS uwid FROM public.documents d
      UNION ALL SELECT cp.universe_id AS uwid FROM public.campaigns cp
      UNION ALL SELECT ma.universe_id AS uwid FROM public.maps ma
    ) t
    GROUP BY t.uwid
  ) oc ON oc.uwid = un.id
  ORDER BY un.created_at DESC;
END;
$$;

GRANT EXECUTE ON FUNCTION public.admin_list_universes() TO authenticated;

COMMIT;
