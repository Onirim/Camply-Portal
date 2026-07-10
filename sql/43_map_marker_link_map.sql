-- ══════════════════════════════════════════════════════════════
-- CAMPLY — Lien d'un marqueur de carte vers une AUTRE carte
-- À exécuter sur une base ayant déjà reçu sql/27_map_markers_linked_object.sql
--
-- Un marqueur de carte pouvait déjà pointer vers un personnage ou
-- un document (linked_type IN ('char','doc')). On étend la
-- contrainte pour autoriser également 'map' : un marqueur peut
-- désormais renvoyer vers une autre carte de l'univers (navigation
-- imbriquée, ex: un marqueur de ville sur la carte du monde ouvre
-- le plan détaillé de cette ville).
-- ══════════════════════════════════════════════════════════════

BEGIN;

ALTER TABLE public.map_markers
  DROP CONSTRAINT IF EXISTS map_markers_linked_type_check;

ALTER TABLE public.map_markers
  ADD CONSTRAINT map_markers_linked_type_check
  CHECK (linked_type IN ('char', 'doc', 'map'));

COMMIT;

-- ══════════════════════════════════════════════════════════════
-- Résumé :
--  • map_markers.linked_type accepte désormais 'map' en plus de
--    'char' et 'doc' (linked_id référence alors public.maps.id).
--  • La table public.maps est déjà lisible par tout membre de
--    l'univers (policy "maps_select"), donc aucune règle RLS
--    supplémentaire n'est nécessaire.
-- ══════════════════════════════════════════════════════════════
