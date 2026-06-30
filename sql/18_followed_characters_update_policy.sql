-- ══════════════════════════════════════════════════════════════
-- Migration 18 — Autoriser la mise à jour des personnages suivis
-- ══════════════════════════════════════════════════════════════
--
-- Objectif :
-- Permettre à un utilisateur qui suit un personnage (table
-- followed_characters) de modifier ce personnage.
--
-- Note :
-- Le front Camply limite cette possibilité aux admins déclarés dans
-- APP_CONFIG.adminDiscordUsers, mais côté SQL la règle est basée sur
-- l'abonnement pour rester vérifiable côté base.

DROP POLICY IF EXISTS "characters_update" ON public.characters;
CREATE POLICY "characters_update"
  ON public.characters FOR UPDATE
  USING (
    auth.uid() = user_id
    OR EXISTS (
      SELECT 1
      FROM public.followed_characters fc
      WHERE fc.character_id = characters.id
        AND fc.user_id = auth.uid()
    )
  );
