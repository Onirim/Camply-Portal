-- Table pour les tags locaux sur les personnages suivis
CREATE TABLE IF NOT EXISTS followed_character_tags (
  id           uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id      uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  character_id uuid NOT NULL REFERENCES characters(id) ON DELETE CASCADE,
  tag_id       uuid NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
  created_at   timestamptz DEFAULT now(),
  UNIQUE (user_id, character_id, tag_id)
);

-- Index pour les requêtes fréquentes
CREATE INDEX IF NOT EXISTS idx_followed_character_tags_user
  ON followed_character_tags(user_id);
CREATE INDEX IF NOT EXISTS idx_followed_character_tags_character
  ON followed_character_tags(character_id);

-- RLS
ALTER TABLE followed_character_tags ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users manage their own followed tags"
  ON followed_character_tags
  FOR ALL
  USING  (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);
