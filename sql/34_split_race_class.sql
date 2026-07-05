-- ══════════════════════════════════════════════════════════════
-- Camply — Dédoublement du bloc Race / Classe
-- À coller dans : Supabase Dashboard > SQL Editor > New query
--
-- Le champ unique "race_class" (data JSONB de public.characters)
-- devient deux champs indépendants : "race" et "class". Les
-- personnages existants conservent leur valeur actuelle sous
-- "race" ; "class" démarre vide et se règle depuis l'éditeur.
-- ══════════════════════════════════════════════════════════════

BEGIN;

UPDATE public.characters
SET data = (data - 'race_class') || jsonb_build_object('race', data->'race_class')
WHERE data ? 'race_class';

COMMIT;
