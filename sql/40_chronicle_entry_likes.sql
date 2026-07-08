-- ══════════════════════════════════════════════════════════════
-- Camply Portal — Likes sur les entrées de chronique
--
-- Un utilisateur peut aimer (cœur) une entrée de chronique, une
-- seule fois par entrée. Le total des likes cumulés sur toutes les
-- entrées d'une chronique s'affiche sur son étiquette et dans sa
-- vue détail.
-- ══════════════════════════════════════════════════════════════

BEGIN;

CREATE TABLE IF NOT EXISTS public.chronicle_entry_likes (
  entry_id   UUID NOT NULL REFERENCES public.chronicle_entries(id) ON DELETE CASCADE,
  user_id    UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (entry_id, user_id)
);

CREATE INDEX IF NOT EXISTS entry_likes_entry_id_idx ON public.chronicle_entry_likes(entry_id);

ALTER TABLE public.chronicle_entry_likes ENABLE ROW LEVEL SECURITY;

-- Reprend la logique de visibilité de "entries_select" (sql/38) pour
-- déterminer qui peut voir/aimer une entrée donnée, sans dupliquer
-- l'expression dans chaque policy authenticated ci-dessous.
CREATE OR REPLACE FUNCTION public.can_view_chronicle_entry(p_entry_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.chronicle_entries e
    JOIN public.chronicles c ON c.id = e.chronicle_id
    WHERE e.id = p_entry_id
      AND (
        c.user_id = auth.uid()
        OR (
          c.is_public = TRUE
          AND (
            public.has_universe_role(c.universe_id, ARRAY['owner', 'gm'])
            OR (
              public.shares_campaign_with(c.universe_id, c.user_id, auth.uid())
              AND (
                NOT public.campaign_content_restricted(c.universe_id)
                OR EXISTS (
                  SELECT 1
                  FROM public.campaign_members cm
                  JOIN public.campaigns cc ON cc.id = cm.campaign_id
                  JOIN public.campaign_visible_chronicles cvc ON cvc.campaign_id = cc.id
                  WHERE cc.universe_id = c.universe_id
                    AND cm.user_id = auth.uid()
                    AND cvc.chronicle_id = c.id
                )
              )
            )
          )
        )
      )
  );
$$;

GRANT EXECUTE ON FUNCTION public.can_view_chronicle_entry(UUID) TO authenticated;

DROP POLICY IF EXISTS "entry_likes_select" ON public.chronicle_entry_likes;
CREATE POLICY "entry_likes_select" ON public.chronicle_entry_likes FOR SELECT
  USING (public.can_view_chronicle_entry(entry_id));

-- Visiteurs anonymes : mêmes règles que "entries_select_anon", pas de
-- notion de campagne puisqu'ils ne sont membres d'aucun univers.
DROP POLICY IF EXISTS "entry_likes_select_anon" ON public.chronicle_entry_likes;
CREATE POLICY "entry_likes_select_anon" ON public.chronicle_entry_likes FOR SELECT
  TO anon
  USING (EXISTS (
    SELECT 1 FROM public.chronicle_entries e
    JOIN public.chronicles c ON c.id = e.chronicle_id
    WHERE e.id = chronicle_entry_likes.entry_id AND c.is_public = TRUE
  ));

DROP POLICY IF EXISTS "entry_likes_insert" ON public.chronicle_entry_likes;
CREATE POLICY "entry_likes_insert" ON public.chronicle_entry_likes FOR INSERT
  WITH CHECK (auth.uid() = user_id AND public.can_view_chronicle_entry(entry_id));

DROP POLICY IF EXISTS "entry_likes_delete" ON public.chronicle_entry_likes;
CREATE POLICY "entry_likes_delete" ON public.chronicle_entry_likes FOR DELETE
  USING (auth.uid() = user_id);

COMMIT;

-- ══════════════════════════════════════════════════════════════
-- Fin.
-- ══════════════════════════════════════════════════════════════
