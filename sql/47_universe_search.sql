-- ══════════════════════════════════════════════════════════════
-- CAMPLY — Recherche full-text dans un univers
-- À coller dans : Supabase Dashboard > SQL Editor > New query
--
-- Fournit une fonction RPC unique `search_universe(universe, query)`
-- qui cherche un ou plusieurs mots à travers TOUS les éléments d'un
-- univers et renvoie de quoi naviguer directement vers chaque résultat
-- (les fonctions navigateToXxx() côté client).
--
-- Portée de la recherche :
--   • characters         → nom, sous-titre, race, classe, description,
--                          historique, traits (nom + détail), compétences,
--                          caractéristiques
--   • chronicles         → titre, description
--   • chronicle_entries  → titre, contenu
--   • documents          → titre, contenu
--   • map_markers        → nom, description  (le résultat pointe vers la
--                          carte contenant le marqueur)
--
-- Bilingue : chaque texte est testé avec les dictionnaires 'french' ET
-- 'english' ; le score retenu est le meilleur des deux.
--
-- Sécurité : la fonction est SECURITY INVOKER → la RLS de chaque table
-- s'applique automatiquement. La recherche ne renvoie donc QUE les
-- éléments que l'utilisateur a déjà le droit de lire (ses propres objets
-- + le contenu partagé auquel il a accès), exactement comme le reste de
-- l'application. Un garde `is_universe_member` coupe court si l'appelant
-- n'appartient pas à l'univers.
-- ══════════════════════════════════════════════════════════════

BEGIN;

DROP FUNCTION IF EXISTS public.search_universe(uuid, text);

CREATE OR REPLACE FUNCTION public.search_universe(
  p_universe_id uuid,
  p_query       text
)
RETURNS TABLE (
  kind      text,   -- 'char' | 'chr' | 'entry' | 'doc' | 'marker'
  id        uuid,   -- cible passée à navigateToXxx() ; pour 'marker' = id de la carte
  parent_id uuid,   -- 'entry' → id de la chronique parente ; sinon NULL
  title     text,
  snippet   text,   -- extrait surligné via les jetons @@HL@@ … @@/HL@@
  score     real
)
LANGUAGE plpgsql
SECURITY INVOKER
STABLE
SET search_path = public
AS $$
DECLARE
  q_fr   tsquery;
  q_en   tsquery;
  v_opts text := 'StartSel="@@HL@@", StopSel="@@/HL@@", MaxFragments=1, MaxWords=24, MinWords=8, ShortWord=2, HighlightAll=FALSE';
BEGIN
  -- Réservé aux membres de l'univers.
  IF NOT public.is_universe_member(p_universe_id, auth.uid()) THEN
    RETURN;
  END IF;

  p_query := btrim(coalesce(p_query, ''));
  IF length(p_query) < 2 THEN
    RETURN;
  END IF;

  q_fr := websearch_to_tsquery('french',  p_query);
  q_en := websearch_to_tsquery('english', p_query);

  -- Requête vide (uniquement des mots vides / de la ponctuation) → rien.
  IF numnode(q_fr) = 0 AND numnode(q_en) = 0 THEN
    RETURN;
  END IF;

  RETURN QUERY
  SELECT
    b.kind,
    b.id,
    b.parent_id,
    b.title,
    CASE
      WHEN to_tsvector('french', b.doc) @@ q_fr
        THEN ts_headline('french',  coalesce(nullif(b.src, ''), b.title), q_fr, v_opts)
      ELSE   ts_headline('english', coalesce(nullif(b.src, ''), b.title), q_en, v_opts)
    END AS snippet,
    greatest(
      ts_rank(to_tsvector('french',  b.doc), q_fr),
      ts_rank(to_tsvector('english', b.doc), q_en)
    ) AS score
  FROM (
    -- ── Personnages ──────────────────────────────────────────
    SELECT
      'char'::text AS kind,
      c.id         AS id,
      NULL::uuid   AS parent_id,
      c.name       AS title,
      concat_ws(' ',
        c.name,
        c.data->>'subtitle',
        c.data->>'race',
        c.data->>'class',
        c.data->>'description',
        c.data->>'background',
        (SELECT string_agg(concat_ws(' ', tr->>'name', tr->>'detail'), ' ')
           FROM jsonb_array_elements(coalesce(c.data->'traits', '[]'::jsonb)) AS tr),
        (SELECT string_agg(sk->>'name', ' ')
           FROM jsonb_array_elements(coalesce(c.data->'skills', '[]'::jsonb)) AS sk),
        (SELECT string_agg(concat_ws(' ', ch->>'name', ch->>'trigram'), ' ')
           FROM jsonb_array_elements(coalesce(c.data->'characteristics', '[]'::jsonb)) AS ch)
      ) AS doc,
      concat_ws('. ',
        c.data->>'description',
        c.data->>'background',
        (SELECT string_agg(concat_ws(' : ', tr->>'name', tr->>'detail'), '. ')
           FROM jsonb_array_elements(coalesce(c.data->'traits', '[]'::jsonb)) AS tr)
      ) AS src
    FROM public.characters c
    WHERE c.universe_id = p_universe_id

    UNION ALL

    -- ── Chroniques ───────────────────────────────────────────
    SELECT
      'chr'::text,
      ch.id,
      NULL::uuid,
      ch.title,
      concat_ws(' ', ch.title, ch.description),
      ch.description
    FROM public.chronicles ch
    WHERE ch.universe_id = p_universe_id

    UNION ALL

    -- ── Entrées de chronique ─────────────────────────────────
    -- (chronicle_entries n'a pas d'universe_id : on passe par la chronique)
    SELECT
      'entry'::text,
      e.id,
      e.chronicle_id,
      e.title,
      concat_ws(' ', e.title, e.content),
      e.content
    FROM public.chronicle_entries e
    JOIN public.chronicles ch2 ON ch2.id = e.chronicle_id
    WHERE ch2.universe_id = p_universe_id

    UNION ALL

    -- ── Documents ────────────────────────────────────────────
    SELECT
      'doc'::text,
      d.id,
      NULL::uuid,
      d.title,
      concat_ws(' ', d.title, d.content),
      d.content
    FROM public.documents d
    WHERE d.universe_id = p_universe_id

    UNION ALL

    -- ── Marqueurs de carte ───────────────────────────────────
    -- Le résultat pointe vers la carte (maps.id) qui contient le marqueur,
    -- reliée via (universe_id, map_key).
    SELECT
      'marker'::text,
      m.id,                       -- id de la carte, attendu par navigateToMap()
      NULL::uuid,
      mk.name,
      concat_ws(' ', mk.name, mk.description),
      mk.description
    FROM public.map_markers mk
    JOIN public.maps m
      ON m.universe_id = mk.universe_id
     AND m.map_key     = mk.map_key
    WHERE mk.universe_id = p_universe_id
  ) AS b
  WHERE to_tsvector('french',  b.doc) @@ q_fr
     OR to_tsvector('english', b.doc) @@ q_en
  ORDER BY score DESC, b.title ASC
  LIMIT 60;
END;
$$;

GRANT EXECUTE ON FUNCTION public.search_universe(uuid, text) TO authenticated;

COMMIT;

-- ══════════════════════════════════════════════════════════════
-- Note perf : la recherche calcule to_tsvector à la volée. Les données
-- sont scindées par univers (petits sous-ensembles), donc pas d'index
-- full-text pour l'instant. Si le volume grossit, ajouter des index GIN
-- d'expression (french + english) sur les colonnes concernées.
-- ══════════════════════════════════════════════════════════════
