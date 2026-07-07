-- ══════════════════════════════════════════════════════════════
-- Camply Portal — Liens d'invitation d'univers
--
-- Remplace l'invitation par nom d'utilisateur par un lien à la
-- Discord : le propriétaire génère une URL, valable 7 jours, que
-- n'importe quel utilisateur du site peut ouvrir pour voir un
-- aperçu de l'univers (illustration, nom, description) et
-- confirmer son adhésion.
--
-- Un seul lien actif par univers : le régénérer invalide l'ancien.
-- ══════════════════════════════════════════════════════════════

BEGIN;

CREATE TABLE IF NOT EXISTS public.universe_invites (
  universe_id UUID PRIMARY KEY REFERENCES public.universes(id) ON DELETE CASCADE,
  token       TEXT NOT NULL UNIQUE,
  created_by  UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at  TIMESTAMPTZ NOT NULL
);

ALTER TABLE public.universe_invites ENABLE ROW LEVEL SECURITY;

-- Seuls le propriétaire/admin de l'univers peuvent voir le lien actif
-- (pour l'afficher dans l'écran de configuration). Le flux de
-- consultation/adhésion côté invité passe par les fonctions
-- SECURITY DEFINER ci-dessous, qui contournent la RLS.
DROP POLICY IF EXISTS "universe_invites_select_admin" ON public.universe_invites;
CREATE POLICY "universe_invites_select_admin"
  ON public.universe_invites FOR SELECT
  USING (public.has_universe_role(universe_id, ARRAY['owner','admin']));

-- ══════════════════════════════════════════════════════════════
-- Génération / régénération du lien (propriétaire ou admin)
-- ══════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.generate_universe_invite(p_universe_id UUID)
RETURNS TABLE(token TEXT, expires_at TIMESTAMPTZ)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_token   TEXT;
  v_expires TIMESTAMPTZ := NOW() + INTERVAL '7 days';
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;

  IF NOT public.has_universe_role(p_universe_id, ARRAY['owner','admin']) THEN
    RAISE EXCEPTION 'Non autorisé';
  END IF;

  v_token := replace(gen_random_uuid()::text, '-', '');

  INSERT INTO public.universe_invites (universe_id, token, created_by, expires_at)
  VALUES (p_universe_id, v_token, auth.uid(), v_expires)
  ON CONFLICT (universe_id) DO UPDATE
    SET token      = EXCLUDED.token,
        created_by = EXCLUDED.created_by,
        created_at = NOW(),
        expires_at = EXCLUDED.expires_at;

  RETURN QUERY SELECT v_token, v_expires;
END;
$$;

GRANT EXECUTE ON FUNCTION public.generate_universe_invite(UUID) TO authenticated;

-- ══════════════════════════════════════════════════════════════
-- Aperçu d'une invitation (avant adhésion) — accessible à tout
-- utilisateur connecté, même non-membre de l'univers concerné.
-- ══════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.get_universe_invite_preview(p_token TEXT)
RETURNS TABLE(
  universe_id            UUID,
  name                   TEXT,
  description            TEXT,
  illustration_url       TEXT,
  illustration_position  INT,
  is_member              BOOLEAN,
  is_expired             BOOLEAN
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_invite RECORD;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;

  SELECT ui.universe_id, ui.expires_at INTO v_invite
  FROM public.universe_invites ui
  WHERE ui.token = p_token;

  IF v_invite.universe_id IS NULL THEN
    RAISE EXCEPTION 'Invitation introuvable';
  END IF;

  RETURN QUERY
  SELECT u.id, u.name, u.description, u.illustration_url, u.illustration_position,
         public.is_universe_member(u.id, auth.uid()),
         (v_invite.expires_at < NOW())
  FROM public.universes u
  WHERE u.id = v_invite.universe_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_universe_invite_preview(TEXT) TO authenticated;

-- ══════════════════════════════════════════════════════════════
-- Acceptation d'une invitation : ajoute l'utilisateur courant comme
-- 'player' de l'univers (idempotent si déjà membre).
-- ══════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.accept_universe_invite(p_token TEXT)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_invite RECORD;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;

  SELECT ui.universe_id, ui.expires_at INTO v_invite
  FROM public.universe_invites ui
  WHERE ui.token = p_token;

  IF v_invite.universe_id IS NULL THEN
    RAISE EXCEPTION 'Invitation introuvable';
  END IF;

  IF v_invite.expires_at < NOW() THEN
    RAISE EXCEPTION 'Invitation expirée';
  END IF;

  INSERT INTO public.universe_members (universe_id, user_id, role)
  VALUES (v_invite.universe_id, auth.uid(), 'player')
  ON CONFLICT (universe_id, user_id) DO NOTHING;

  RETURN v_invite.universe_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.accept_universe_invite(TEXT) TO authenticated;

COMMIT;

-- ══════════════════════════════════════════════════════════════
-- Fin.
-- ══════════════════════════════════════════════════════════════
