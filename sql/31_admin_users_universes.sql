-- ══════════════════════════════════════════════════════════════
-- Camply — Panneau d'administration : gestion utilisateurs/univers
-- À coller dans : Supabase Dashboard > SQL Editor > New query
-- Nécessite sql/30_admin_panel.sql (is_admin(), is_orphan_illustration()).
--
-- Ajoute au panneau d'administration :
--   - admin_list_users()                 : liste des comptes avec leur
--     nombre d'univers possédés, d'objets créés, et leur limite
--     d'univers (profiles.max_universes, déjà utilisée par
--     create_universe/transfer_universe_ownership dans 00_fresh_install.sql).
--   - admin_set_user_max_universes(uuid, int) : modifie cette limite.
--   - admin_list_universes()             : liste des univers avec
--     propriétaire, nombre de membres et d'objets, statut pause.
--   - admin_pause_universe(uuid)         : met en pause n'importe quel
--     univers (réutilise _pause_universe_internal, sans exiger d'en
--     être propriétaire).
--   - admin_resume_universe(uuid)        : réactive n'importe quel
--     univers (réutilise _resume_universe_internal, sans exiger d'en
--     être membre).
--   - admin_delete_universe(uuid)        : supprime n'importe quel
--     univers (même logique que delete_universe, sans exigence de
--     propriété), renvoie les URLs d'illustration à nettoyer côté
--     storage côté client.
--
-- Toutes ces fonctions revérifient is_admin() indépendamment du menu
-- masqué côté client.
-- ══════════════════════════════════════════════════════════════

BEGIN;

-- ── 1. Liste des utilisateurs ────────────────────────────────────

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
    SELECT owner_id, count(*) AS owned_count
    FROM public.universes
    GROUP BY owner_id
  ) uc ON uc.owner_id = p.id
  LEFT JOIN (
    SELECT user_id, count(*) AS total FROM (
      SELECT user_id FROM public.characters
      UNION ALL SELECT user_id FROM public.chronicles
      UNION ALL SELECT user_id FROM public.documents
      UNION ALL SELECT user_id FROM public.campaigns
      UNION ALL SELECT created_by AS user_id FROM public.maps
    ) t
    GROUP BY user_id
  ) oc ON oc.user_id = p.id
  ORDER BY au.created_at;
END;
$$;

GRANT EXECUTE ON FUNCTION public.admin_list_users() TO authenticated;


-- ── 2. Modification de la limite d'univers d'un utilisateur ─────

CREATE OR REPLACE FUNCTION public.admin_set_user_max_universes(p_user_id UUID, p_max_universes INT)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'Accès réservé aux administrateurs';
  END IF;

  IF p_max_universes < 0 THEN
    RAISE EXCEPTION 'La limite doit être positive ou nulle';
  END IF;

  UPDATE public.profiles SET max_universes = p_max_universes WHERE id = p_user_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Utilisateur introuvable';
  END IF;
END;
$$;

GRANT EXECUTE ON FUNCTION public.admin_set_user_max_universes(UUID, INT) TO authenticated;


-- ── 3. Liste des univers ─────────────────────────────────────────

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
    SELECT universe_id, count(*) AS member_count
    FROM public.universe_members
    GROUP BY universe_id
  ) mc ON mc.universe_id = un.id
  LEFT JOIN (
    SELECT universe_id, count(*) AS total FROM (
      SELECT universe_id FROM public.characters
      UNION ALL SELECT universe_id FROM public.chronicles
      UNION ALL SELECT universe_id FROM public.documents
      UNION ALL SELECT universe_id FROM public.campaigns
      UNION ALL SELECT universe_id FROM public.maps
    ) t
    GROUP BY universe_id
  ) oc ON oc.universe_id = un.id
  ORDER BY un.created_at DESC;
END;
$$;

GRANT EXECUTE ON FUNCTION public.admin_list_universes() TO authenticated;


-- ── 4. Pause / réactivation par un administrateur ────────────────
-- Contrairement à pause_universe()/resume_universe() (cf.
-- 29_universe_pause.sql), aucune exigence de propriété ou de
-- membership : un admin peut agir sur n'importe quel univers.

CREATE OR REPLACE FUNCTION public.admin_pause_universe(p_universe_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'Accès réservé aux administrateurs';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.universes WHERE id = p_universe_id) THEN
    RAISE EXCEPTION 'Univers introuvable';
  END IF;

  PERFORM public._pause_universe_internal(p_universe_id);
END;
$$;

GRANT EXECUTE ON FUNCTION public.admin_pause_universe(UUID) TO authenticated;

CREATE OR REPLACE FUNCTION public.admin_resume_universe(p_universe_id UUID)
RETURNS public.universes
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_universe public.universes;
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'Accès réservé aux administrateurs';
  END IF;

  SELECT * INTO v_universe FROM public.universes WHERE id = p_universe_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Univers introuvable';
  END IF;

  IF v_universe.paused_at IS NOT NULL THEN
    PERFORM public._resume_universe_internal(p_universe_id);
    SELECT * INTO v_universe FROM public.universes WHERE id = p_universe_id;
  END IF;

  RETURN v_universe;
END;
$$;

GRANT EXECUTE ON FUNCTION public.admin_resume_universe(UUID) TO authenticated;


-- ── 5. Suppression par un administrateur ─────────────────────────
-- Même logique que delete_universe() (cf. 28_storage_illustrations_fixes.sql)
-- mais sans exiger d'en être propriétaire.
-- Note : si l'univers est en pause, ses personnages/chroniques/documents
-- sont déjà archivés dans universe_archives (colonnes vides dans les
-- tables vives) : leurs illustrations ne sont donc pas listées ici,
-- mais universe_archives est supprimée en cascade avec l'univers, ce
-- qui rend ces fichiers orphelins — ils seront nettoyés par la purge
-- des orphelins. C'est le même comportement que delete_universe().

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
  ) t;

  DELETE FROM public.universes WHERE id = p_universe_id;

  RETURN v_urls;
END;
$$;

GRANT EXECUTE ON FUNCTION public.admin_delete_universe(UUID) TO authenticated;

COMMIT;
