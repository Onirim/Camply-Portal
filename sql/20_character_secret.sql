-- ══════════════════════════════════════════════════════════════
-- Camply — Notes secrètes personnelles sur un personnage
-- Chaque joueur peut noter ce qu'il veut sur N'IMPORTE QUEL
-- personnage (le sien ou un personnage suivi/public).
-- Cette note n'est visible que par son auteur.
-- ══════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS public.character_secrets (
  character_id UUID NOT NULL REFERENCES public.characters(id) ON DELETE CASCADE,
  user_id      UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  content      TEXT NOT NULL DEFAULT '',
  updated_at   TIMESTAMPTZ DEFAULT NOW(),
  PRIMARY KEY (character_id, user_id)
);

CREATE INDEX IF NOT EXISTS character_secrets_user_idx ON public.character_secrets(user_id);

DROP TRIGGER IF EXISTS on_character_secrets_updated ON public.character_secrets;
CREATE TRIGGER on_character_secrets_updated
  BEFORE UPDATE ON public.character_secrets
  FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

ALTER TABLE public.character_secrets ENABLE ROW LEVEL SECURITY;

-- On ne peut lire/modifier/supprimer que SES PROPRES notes (user_id = auth.uid()).
-- Pour écrire (insert/update), il faut en plus pouvoir voir le personnage
-- (le sien, ou un personnage public) — sinon on pourrait écrire une note
-- sur un personnage privé d'un autre joueur dont on devine juste l'id.
DROP POLICY IF EXISTS "character_secrets_own_notes" ON public.character_secrets;
CREATE POLICY "character_secrets_own_notes" ON public.character_secrets FOR ALL
  USING (user_id = auth.uid())
  WITH CHECK (
    user_id = auth.uid()
    AND EXISTS (
      SELECT 1 FROM public.characters c
      WHERE c.id = character_id
        AND (c.user_id = auth.uid() OR c.is_public = TRUE)
    )
  );
