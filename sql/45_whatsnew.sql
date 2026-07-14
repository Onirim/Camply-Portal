-- ══════════════════════════════════════════════════════════════
-- Camply — Nouveautés (changelog affiché à la connexion)
-- À coller dans : Supabase Dashboard > SQL Editor > New query
--
-- Ajoute une table public.news (rédigée en markdown depuis le
-- panneau d'administration) et le suivi par utilisateur de ce qui a
-- déjà été vu (profiles.last_seen_news_at). À la connexion, le client
-- appelle get_unseen_news() : toute nouveauté publiée après la
-- dernière visite est concaténée dans une modale (cf. whatsnew.js,
-- même chrome que legal.js), puis mark_news_seen() avance le curseur.
--
-- news n'a aucune policy RLS : elle n'est lisible/modifiable que via
-- les fonctions SECURITY DEFINER ci-dessous, jamais directement par
-- les clients (même pattern que admin_users, cf. 30_admin_panel.sql).
-- ══════════════════════════════════════════════════════════════

BEGIN;

-- ── 1. Table des nouveautés ──────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.news (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title             TEXT NOT NULL,
  content_markdown  TEXT NOT NULL,
  published_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by        UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE public.news ENABLE ROW LEVEL SECURITY;


-- ── 2. Suivi par utilisateur ─────────────────────────────────────
-- Défaut à NOW() : un compte déjà existant au moment de la migration
-- ne se retrouve pas avec tout l'historique des nouveautés à sa
-- prochaine connexion.

ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS last_seen_news_at TIMESTAMPTZ NOT NULL DEFAULT NOW();


-- ── 3. Lecture utilisateur ───────────────────────────────────────

CREATE OR REPLACE FUNCTION public.get_unseen_news()
RETURNS TABLE(id UUID, title TEXT, content_markdown TEXT, published_at TIMESTAMPTZ)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT n.id, n.title, n.content_markdown, n.published_at
  FROM public.news n
  WHERE n.published_at > (SELECT p.last_seen_news_at FROM public.profiles p WHERE p.id = auth.uid())
    AND n.published_at <= NOW()
  ORDER BY n.published_at ASC;
$$;

GRANT EXECUTE ON FUNCTION public.get_unseen_news() TO authenticated;


CREATE OR REPLACE FUNCTION public.mark_news_seen(p_up_to TIMESTAMPTZ)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE public.profiles
  SET last_seen_news_at = p_up_to
  WHERE id = auth.uid()
    AND p_up_to > last_seen_news_at;
END;
$$;

GRANT EXECUTE ON FUNCTION public.mark_news_seen(TIMESTAMPTZ) TO authenticated;


-- ── 4. Gestion admin ──────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.admin_list_news()
RETURNS TABLE(id UUID, title TEXT, content_markdown TEXT, published_at TIMESTAMPTZ, created_at TIMESTAMPTZ)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'Accès réservé aux administrateurs';
  END IF;

  RETURN QUERY
  SELECT n.id, n.title, n.content_markdown, n.published_at, n.created_at
  FROM public.news n
  ORDER BY n.published_at DESC;
END;
$$;

GRANT EXECUTE ON FUNCTION public.admin_list_news() TO authenticated;


CREATE OR REPLACE FUNCTION public.admin_create_news(p_title TEXT, p_content_markdown TEXT, p_published_at TIMESTAMPTZ DEFAULT NOW())
RETURNS UUID
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

  INSERT INTO public.news (title, content_markdown, published_at, created_by)
  VALUES (p_title, p_content_markdown, p_published_at, auth.uid())
  RETURNING id INTO v_id;

  RETURN v_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.admin_create_news(TEXT, TEXT, TIMESTAMPTZ) TO authenticated;


CREATE OR REPLACE FUNCTION public.admin_update_news(p_id UUID, p_title TEXT, p_content_markdown TEXT, p_published_at TIMESTAMPTZ)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'Accès réservé aux administrateurs';
  END IF;

  UPDATE public.news
  SET title = p_title, content_markdown = p_content_markdown, published_at = p_published_at
  WHERE id = p_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.admin_update_news(UUID, TEXT, TEXT, TIMESTAMPTZ) TO authenticated;


CREATE OR REPLACE FUNCTION public.admin_delete_news(p_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'Accès réservé aux administrateurs';
  END IF;

  DELETE FROM public.news WHERE id = p_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.admin_delete_news(UUID) TO authenticated;

COMMIT;
