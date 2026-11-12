-- ══════════════════════════════════════════════════════════════
-- Camply — Mise en pause des univers inactifs depuis le panneau admin
-- À exécuter après sql/29_universe_pause.sql et sql/30_admin_panel.sql.
--
-- À l'ouverture du panneau admin, cette RPC met en pause les univers
-- actifs que personne n'a visités depuis deux mois, indépendamment
-- de l'activité de leur propriétaire.
-- ══════════════════════════════════════════════════════════════

BEGIN;

CREATE OR REPLACE FUNCTION public.admin_pause_stale_universes()
RETURNS SETOF UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_id UUID;
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'Accès réservé aux administrateurs';
  END IF;

  FOR v_id IN
    SELECT id
    FROM public.universes
    WHERE paused_at IS NULL
      AND last_visited_at < NOW() - INTERVAL '2 months'
  LOOP
    PERFORM public._pause_universe_internal(v_id);
    RETURN NEXT v_id;
  END LOOP;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_pause_stale_universes() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_pause_stale_universes() TO authenticated;

COMMIT;
