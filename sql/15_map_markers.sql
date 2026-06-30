-- ══════════════════════════════════════════════════════════════
-- CAMPLY — Marqueurs de carte personnels
-- À coller dans : Supabase Dashboard > SQL Editor > New query
-- ══════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS public.map_markers (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,

  -- Position exprimée en pourcentage de l'image (0.0 → 1.0)
  -- Indépendant de la résolution affichée.
  x           DOUBLE PRECISION NOT NULL CHECK (x >= 0 AND x <= 1),
  y           DOUBLE PRECISION NOT NULL CHECK (y >= 0 AND y <= 1),

  name        TEXT NOT NULL DEFAULT '',
  description TEXT NOT NULL DEFAULT '',
  color       TEXT NOT NULL DEFAULT '#e8c46a',

  created_at  TIMESTAMPTZ DEFAULT NOW(),
  updated_at  TIMESTAMPTZ DEFAULT NOW()
);

-- Index pour récupérer rapidement les marqueurs d'un utilisateur
CREATE INDEX IF NOT EXISTS map_markers_user_id_idx ON public.map_markers(user_id);

-- Trigger updated_at (réutilise la fonction créée dans 00_schema.sql)
DROP TRIGGER IF EXISTS on_map_markers_updated ON public.map_markers;
CREATE TRIGGER on_map_markers_updated
  BEFORE UPDATE ON public.map_markers
  FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

-- ── RLS ──────────────────────────────────────────────────────
ALTER TABLE public.map_markers ENABLE ROW LEVEL SECURITY;

-- Chaque utilisateur gère uniquement ses propres marqueurs
DROP POLICY IF EXISTS "map_markers_all_own" ON public.map_markers;
CREATE POLICY "map_markers_all_own"
  ON public.map_markers
  FOR ALL
  USING  (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- ══════════════════════════════════════════════════════════════
-- Les marqueurs sont stockés avec une position relative (0→1)
-- afin d'être indépendants des dimensions d'affichage.
-- ══════════════════════════════════════════════════════════════
