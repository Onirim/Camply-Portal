-- ══════════════════════════════════════════════════════════════
-- CAMPLY — Lien d'un marqueur de carte vers un objet de l'univers
-- À exécuter sur une base ayant déjà reçu sql/00_fresh_install.sql
-- (jusqu'à sql/26_map_layer_remove_title_description.sql inclus).
--
-- Un marqueur de carte peut désormais pointer vers un personnage ou
-- un document de l'univers. La popup d'information du marqueur
-- affiche alors un lien cliquable vers la fiche de cet objet.
-- ══════════════════════════════════════════════════════════════

BEGIN;

ALTER TABLE public.map_markers
  ADD COLUMN IF NOT EXISTS linked_type TEXT CHECK (linked_type IN ('char', 'doc')),
  ADD COLUMN IF NOT EXISTS linked_id UUID;

COMMIT;

-- ══════════════════════════════════════════════════════════════
-- Résumé :
--  • map_markers gagne linked_type ('char'|'doc'|NULL) et linked_id
--    (uuid du personnage ou document lié, NULL si aucun lien).
--  • Toute requête sb.from('map_markers').select(...) doit inclure
--    ces deux colonnes (cf. map.js).
-- ══════════════════════════════════════════════════════════════
