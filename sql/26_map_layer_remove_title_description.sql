-- ══════════════════════════════════════════════════════════════
-- CAMPLY — Suppression du titre et de la description des couches
-- À exécuter sur une base ayant déjà reçu sql/00_fresh_install.sql
-- (jusqu'à sql/25_unify_tags.sql inclus).
--
-- Une couche de carte (map_layers) n'a pas besoin de nom ni de
-- description : elle est entièrement définie par la carte à laquelle
-- elle est liée (map_key) et son propriétaire (user_id). Le frontend
-- identifie désormais une couche par le nom de la carte associée et
-- le nom d'utilisateur du propriétaire, jamais par un champ libre.
--
-- Migration destructive : les titres/descriptions existants sont perdus.
-- ══════════════════════════════════════════════════════════════

BEGIN;

ALTER TABLE public.map_layers DROP COLUMN IF EXISTS title;
ALTER TABLE public.map_layers DROP COLUMN IF EXISTS description;

COMMIT;

-- ══════════════════════════════════════════════════════════════
-- Résumé :
--  • map_layers n'a plus de colonnes title/description.
--  • Toute requête sb.from('map_layers').select(...) doit être mise à
--    jour pour retirer ces champs (cf. map.js, campaigns.js, export.js).
-- ══════════════════════════════════════════════════════════════
