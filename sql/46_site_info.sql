-- ══════════════════════════════════════════════════════════════
-- Camply — Page d'information (modale « À propos »)
-- À coller dans : Supabase Dashboard > SQL Editor > New query
--
-- Ajoute une table public.site_info contenant les sections fixes de
-- la modale d'information ouverte depuis l'écran de choix d'univers
-- (cf. siteinfo.js) : « Pourquoi Camply ? », « Tarifs » et
-- « Comment ça marche ». Le contenu est rédigé en markdown depuis le
-- panneau d'administration, en français avec version anglaise
-- optionnelle (repli sur le français côté client, comme les news).
--
-- site_info n'a aucune policy RLS : elle n'est lisible/modifiable que
-- via les fonctions SECURITY DEFINER ci-dessous, jamais directement
-- par les clients (même pattern que news, cf. 45_whatsnew.sql).
-- ══════════════════════════════════════════════════════════════

BEGIN;

-- ── 1. Table des sections ────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.site_info (
  slug                 TEXT PRIMARY KEY,
  title                TEXT NOT NULL,
  content_markdown     TEXT NOT NULL DEFAULT '',
  title_en             TEXT,
  content_markdown_en  TEXT,
  sort_order           INT NOT NULL DEFAULT 0,
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_by           UUID REFERENCES auth.users(id) ON DELETE SET NULL
);

ALTER TABLE public.site_info ENABLE ROW LEVEL SECURITY;

-- Sections fixes : créées une fois, jamais ajoutées/supprimées depuis
-- le client (seul le contenu est éditable via admin_update_site_info).
INSERT INTO public.site_info (slug, title, title_en, content_markdown, sort_order) VALUES
  ('why',     'Pourquoi Camply ?',   'Why Camply?',    '*(Contenu à rédiger depuis le panneau d''administration.)*', 1),
  ('pricing', 'Tarifs',              'Pricing',        '*(Contenu à rédiger depuis le panneau d''administration.)*', 2),
  ('how',     'Comment ça marche',   'How it works',   '*(Contenu à rédiger depuis le panneau d''administration.)*', 3)
ON CONFLICT (slug) DO NOTHING;


-- ── 2. Lecture utilisateur ───────────────────────────────────────

CREATE OR REPLACE FUNCTION public.get_site_info()
RETURNS TABLE(slug TEXT, title TEXT, content_markdown TEXT, title_en TEXT, content_markdown_en TEXT, sort_order INT)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT s.slug, s.title, s.content_markdown, s.title_en, s.content_markdown_en, s.sort_order
  FROM public.site_info s
  ORDER BY s.sort_order ASC;
$$;

GRANT EXECUTE ON FUNCTION public.get_site_info() TO authenticated;


-- ── 3. Édition admin ─────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.admin_update_site_info(
  p_slug                TEXT,
  p_title               TEXT,
  p_content_markdown    TEXT,
  p_title_en            TEXT,
  p_content_markdown_en TEXT)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'Accès réservé aux administrateurs';
  END IF;

  UPDATE public.site_info
  SET title = p_title,
      content_markdown = p_content_markdown,
      title_en = NULLIF(p_title_en, ''),
      content_markdown_en = NULLIF(p_content_markdown_en, ''),
      updated_at = NOW(),
      updated_by = auth.uid()
  WHERE slug = p_slug;
END;
$$;

GRANT EXECUTE ON FUNCTION public.admin_update_site_info(TEXT, TEXT, TEXT, TEXT, TEXT) TO authenticated;

COMMIT;
