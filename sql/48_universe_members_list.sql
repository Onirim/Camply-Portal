-- ══════════════════════════════════════════════════════════════
-- CAMPLY — Liste des membres d'un univers en un seul aller-retour
-- À coller dans : Supabase Dashboard > SQL Editor > New query
--
-- Avant : l'onglet Configuration chargeait les membres en deux requêtes
-- enchaînées (universe_members, puis profiles pour les pseudos), soit deux
-- allers-retours réseau successifs avant le premier rendu.
--
-- `get_universe_members` fait la jointure côté base et renvoie tout en une
-- seule requête.
--
-- Sécurité : SECURITY INVOKER → la RLS s'applique exactement comme avant
-- (universe_members_select_same_universe pour l'appartenance,
-- profiles_select_public pour le pseudo). Un garde `is_universe_member`
-- coupe court si l'appelant n'appartient pas à l'univers.
-- ══════════════════════════════════════════════════════════════

BEGIN;

DROP FUNCTION IF EXISTS public.get_universe_members(uuid);

CREATE OR REPLACE FUNCTION public.get_universe_members(p_universe_id uuid)
RETURNS TABLE (
  user_id   uuid,
  role      text,
  joined_at timestamptz,
  username  text
)
LANGUAGE sql
SECURITY INVOKER
STABLE
SET search_path = public
AS $$
  SELECT m.user_id,
         m.role,
         m.joined_at,
         COALESCE(p.username, '?') AS username
  FROM public.universe_members m
  LEFT JOIN public.profiles p ON p.id = m.user_id
  WHERE m.universe_id = p_universe_id
    AND public.is_universe_member(p_universe_id, auth.uid())
  ORDER BY m.joined_at ASC;
$$;

GRANT EXECUTE ON FUNCTION public.get_universe_members(uuid) TO authenticated;

COMMIT;
