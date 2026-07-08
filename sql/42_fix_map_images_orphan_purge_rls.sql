-- ══════════════════════════════════════════════════════════════
-- Camply Portal — Correctif : la purge des orphelins map-images
-- échoue silencieusement pour un admin qui ne possède aucun univers
--
-- map_images_delete_orphan_by_any_owner (sql/28) exige
-- EXISTS (SELECT 1 FROM universes WHERE owner_id = auth.uid()) en plus
-- de is_orphan_illustration(). Un compte admin sans univers personnel
-- (cf. admin_users, sql/30) ne remplit jamais cette condition : la
-- suppression via l'API Storage est bloquée par RLS sans erreur
-- visible (sb.storage.remove() renvoie juste moins d'objets supprimés
-- que demandé). C'est pourquoi purgeOrphans() nettoyait bien les
-- fichiers character-illustrations (policy sans cette restriction)
-- mais laissait les fichiers map-images en place.
--
-- On ajoute is_admin() comme alternative à la propriété d'un univers,
-- sur le même principe que illustrations_delete_own côté
-- character-illustrations (is_orphan_illustration() est déjà la seule
-- garantie de sécurité nécessaire : un fichier réellement utilisé ne
-- peut jamais la valider).
-- ══════════════════════════════════════════════════════════════

BEGIN;

DROP POLICY IF EXISTS "map_images_delete_orphan_by_any_owner" ON storage.objects;
CREATE POLICY "map_images_delete_orphan_by_any_owner"
  ON storage.objects FOR DELETE
  TO authenticated
  USING (
    bucket_id = 'map-images'
    AND (
      EXISTS (SELECT 1 FROM public.universes u WHERE u.owner_id = auth.uid())
      OR public.is_admin()
    )
    AND public.is_orphan_illustration(bucket_id, name)
  );

COMMIT;
