-- ══════════════════════════════════════════════════════════════
-- Camply Portal — Correctif : discriminateur Discord dans username
-- À exécuter sur une base ayant déjà reçu sql/00_fresh_install.sql.
--
-- Bug : raw_user_meta_data->>'full_name' renvoie parfois
-- "pseudo#0" (discriminateur legacy que Discord ajoute encore pour
-- les comptes migrés au nouveau système de pseudos). Ce suffixe se
-- retrouvait tel quel dans profiles.username, ce qui cassait la
-- recherche d'invitation (l'utilisateur tape "pseudo", la base
-- contient "pseudo#0" → aucune correspondance).
--
-- Ce correctif : (1) nettoie le trigger de création de profil pour
-- les futurs comptes, (2) corrige rétroactivement les profils déjà
-- en base.
-- ══════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_username TEXT;
BEGIN
  v_username := COALESCE(
    NEW.raw_user_meta_data->>'full_name',
    NEW.raw_user_meta_data->>'name',
    NEW.raw_user_meta_data->>'username',
    split_part(NEW.email, '@', 1)
  );
  v_username := regexp_replace(v_username, '#[0-9]+$', '');

  INSERT INTO public.profiles (id, username)
  VALUES (NEW.id, v_username)
  ON CONFLICT (id) DO UPDATE SET username = EXCLUDED.username;
  RETURN NEW;
END;
$$;

UPDATE public.profiles
SET username = regexp_replace(username, '#[0-9]+$', '')
WHERE username ~ '#[0-9]+$';
