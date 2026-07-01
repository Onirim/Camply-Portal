-- ══════════════════════════════════════════════════════════════
-- Camply Portal — Correctif : profils manquants
-- À exécuter sur une base ayant déjà reçu sql/00_fresh_install.sql
-- et sql/21_fix_username_discriminator.sql.
--
-- Constat : public.profiles est vide alors que auth.users contient
-- des comptes existants (ex. connectés depuis avril). Le trigger
-- on_auth_user_created (AFTER INSERT ON auth.users) n'a jamais
-- créé leur ligne, et le code client ne faisait qu'un UPDATE à
-- chaque connexion (0 ligne affectée si elle n'existe pas, sans
-- erreur) — rien ne créait donc la ligne après coup.
--
-- Ce correctif :
--   1. Réaffirme le trigger de création (filet de sécurité pour
--      les futures inscriptions).
--   2. Backfill : crée la ligne profiles manquante pour chaque
--      compte auth.users existant.
-- (Le client fait désormais un upsert à chaque connexion, cf.
-- scripts.js — ce backfill couvre les comptes qui ne se sont pas
-- reconnectés depuis ce correctif.)
-- ══════════════════════════════════════════════════════════════

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

INSERT INTO public.profiles (id, username)
SELECT
  u.id,
  regexp_replace(
    COALESCE(
      u.raw_user_meta_data->>'full_name',
      u.raw_user_meta_data->>'name',
      u.raw_user_meta_data->>'username',
      split_part(u.email, '@', 1)
    ),
    '#[0-9]+$', ''
  )
FROM auth.users u
LEFT JOIN public.profiles p ON p.id = u.id
WHERE p.id IS NULL;
