-- ══════════════════════════════════════════════════════════════
-- Camply Portal — Phase 2 : partage par campagne (membres)
-- À exécuter sur une base ayant déjà reçu sql/00_fresh_install.sql
-- puis sql/18_universes_phase1.sql.
--
-- Change de modèle :
--   • Un objet public (personnage/chronique/document/couche de
--     carte) n'est plus partagé via un share_code à transmettre :
--     il devient visible par tout utilisateur qui partage au
--     moins une campagne avec son propriétaire, dans le même
--     univers.
--   • Une campagne n'est plus une collection d'objets mais une
--     collection d'utilisateurs (campaign_members). Seul le
--     propriétaire de l'univers peut créer/gérer des campagnes ;
--     il y est automatiquement inscrit.
--   • Les codes de partage (share_code) et tout le bookkeeping
--     "follow" (followed_characters, followed_chronicles,
--     followed_documents, followed_map_layers, followed_campaigns,
--     campaign_items) disparaissent : la visibilité est calculée
--     par RLS, pas déclarée manuellement.
--
-- C'est une migration destructive (peu de données réelles à
-- préserver à ce stade) : les colonnes/tables obsolètes sont
-- supprimées sans tentative de backfill.
-- ══════════════════════════════════════════════════════════════


-- ══════════════════════════════════════════════════════════════
-- 1. Suppression de l'ancienne infrastructure de partage
-- ══════════════════════════════════════════════════════════════

DROP TABLE IF EXISTS public.followed_characters CASCADE;
DROP TABLE IF EXISTS public.followed_chronicles CASCADE;
DROP TABLE IF EXISTS public.followed_documents  CASCADE;
DROP TABLE IF EXISTS public.followed_map_layers CASCADE;
DROP TABLE IF EXISTS public.followed_campaigns  CASCADE;
DROP TABLE IF EXISTS public.campaign_items      CASCADE;

-- followed_character_tags / followed_document_tags / sync_owner_tags
-- sont conservées telles quelles : elles permettent à un utilisateur
-- de taguer un objet qu'il peut voir, indépendamment de tout
-- mécanisme de "follow". Seuls les appels frontend déclenchés par
-- l'ancien flux "suivre par code" disparaissent (côté JS).


-- ══════════════════════════════════════════════════════════════
-- 2. Suppression des share_code (colonnes, triggers, fonctions, index)
-- ══════════════════════════════════════════════════════════════

DROP TRIGGER IF EXISTS set_share_code              ON public.characters;
DROP TRIGGER IF EXISTS set_chronicle_share_code     ON public.chronicles;
DROP TRIGGER IF EXISTS set_document_share_code      ON public.documents;
DROP TRIGGER IF EXISTS set_map_layer_share_code     ON public.map_layers;
DROP TRIGGER IF EXISTS campaigns_share_code_trigger ON public.campaigns;

DROP FUNCTION IF EXISTS public.generate_share_code() CASCADE;
DROP FUNCTION IF EXISTS public.generate_campaign_share_code() CASCADE;
DROP FUNCTION IF EXISTS generate_campaign_share_code() CASCADE;

-- public.generate_short_code() est conservée : utilisée par
-- set_universe_join_code() pour universes.join_code (fonctionnalité
-- non concernée par ce changement).

DROP INDEX IF EXISTS public.characters_universe_share_code_idx;
DROP INDEX IF EXISTS public.chronicles_universe_share_code_idx;
DROP INDEX IF EXISTS public.documents_universe_share_code_idx;
DROP INDEX IF EXISTS public.campaigns_universe_share_code_idx;
DROP INDEX IF EXISTS public.map_layers_universe_share_code_idx;
DROP INDEX IF EXISTS public.map_markers_share_code_idx;
DROP INDEX IF EXISTS public.campaigns_share_code_idx;

ALTER TABLE public.characters  DROP COLUMN IF EXISTS share_code;
ALTER TABLE public.chronicles  DROP COLUMN IF EXISTS share_code;
ALTER TABLE public.documents   DROP COLUMN IF EXISTS share_code;
ALTER TABLE public.map_layers  DROP COLUMN IF EXISTS share_code;
ALTER TABLE public.map_markers DROP COLUMN IF EXISTS share_code;
ALTER TABLE public.campaigns   DROP COLUMN IF EXISTS share_code;
ALTER TABLE public.campaigns   DROP COLUMN IF EXISTS is_public CASCADE;

-- guard_document_shared_update référençait share_code : on la
-- redéfinit sans cette colonne (allow_write_share reste protégée
-- pour un non-propriétaire).
CREATE OR REPLACE FUNCTION public.guard_document_shared_update()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  IF auth.uid() IS DISTINCT FROM OLD.user_id THEN
    NEW.user_id := OLD.user_id;
    NEW.is_public := OLD.is_public;
    NEW.allow_write_share := OLD.allow_write_share;
  END IF;
  RETURN NEW;
END;
$$;


-- ══════════════════════════════════════════════════════════════
-- 3. Campagnes = collections d'utilisateurs
-- ══════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS public.campaign_members (
  campaign_id UUID NOT NULL REFERENCES public.campaigns(id) ON DELETE CASCADE,
  user_id     UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  added_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (campaign_id, user_id)
);

CREATE INDEX IF NOT EXISTS campaign_members_user_idx ON public.campaign_members(user_id);

-- Le propriétaire de l'univers est automatiquement membre de
-- chaque campagne qu'il crée.
CREATE OR REPLACE FUNCTION public.add_universe_owner_to_campaign()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_owner_id UUID;
BEGIN
  SELECT owner_id INTO v_owner_id FROM public.universes WHERE id = NEW.universe_id;
  IF v_owner_id IS NOT NULL THEN
    INSERT INTO public.campaign_members (campaign_id, user_id)
    VALUES (NEW.id, v_owner_id)
    ON CONFLICT DO NOTHING;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_campaign_created_add_owner ON public.campaigns;
CREATE TRIGGER on_campaign_created_add_owner
  AFTER INSERT ON public.campaigns
  FOR EACH ROW EXECUTE FUNCTION public.add_universe_owner_to_campaign();


-- ══════════════════════════════════════════════════════════════
-- 4. Helper : deux utilisateurs partagent-ils une campagne ?
-- ══════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.shares_campaign_with(
  p_universe_id UUID,
  p_owner_id    UUID,
  p_viewer_id   UUID DEFAULT auth.uid()
)
RETURNS BOOLEAN
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.campaign_members cm1
    JOIN public.campaign_members cm2 ON cm2.campaign_id = cm1.campaign_id
    JOIN public.campaigns c ON c.id = cm1.campaign_id
    WHERE c.universe_id = p_universe_id
      AND cm1.user_id = p_owner_id
      AND cm2.user_id = p_viewer_id
  );
$$;

GRANT EXECUTE ON FUNCTION public.shares_campaign_with(UUID, UUID, UUID) TO authenticated;


-- ══════════════════════════════════════════════════════════════
-- 5. RLS — campaigns / campaign_members
-- ══════════════════════════════════════════════════════════════

DROP POLICY IF EXISTS campaigns_owner  ON public.campaigns;
DROP POLICY IF EXISTS campaigns_public ON public.campaigns;

CREATE POLICY "campaigns_select" ON public.campaigns FOR SELECT
  USING (
    public.has_universe_role(universe_id, ARRAY['owner'])
    OR EXISTS (
      SELECT 1 FROM public.campaign_members cm
      WHERE cm.campaign_id = id AND cm.user_id = auth.uid()
    )
  );

CREATE POLICY "campaigns_insert_owner" ON public.campaigns FOR INSERT
  WITH CHECK (
    user_id = auth.uid()
    AND public.has_universe_role(universe_id, ARRAY['owner'])
  );

CREATE POLICY "campaigns_update_owner" ON public.campaigns FOR UPDATE
  USING (public.has_universe_role(universe_id, ARRAY['owner']))
  WITH CHECK (public.has_universe_role(universe_id, ARRAY['owner']));

CREATE POLICY "campaigns_delete_owner" ON public.campaigns FOR DELETE
  USING (public.has_universe_role(universe_id, ARRAY['owner']));

ALTER TABLE public.campaign_members ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS campaign_items_owner  ON public.campaign_members;
DROP POLICY IF EXISTS campaign_items_public ON public.campaign_members;

CREATE POLICY "campaign_members_select" ON public.campaign_members FOR SELECT
  USING (
    user_id = auth.uid()
    OR EXISTS (
      SELECT 1 FROM public.campaigns c
      WHERE c.id = campaign_id
        AND public.has_universe_role(c.universe_id, ARRAY['owner'])
    )
  );

CREATE POLICY "campaign_members_insert_owner" ON public.campaign_members FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.campaigns c
      WHERE c.id = campaign_id
        AND public.has_universe_role(c.universe_id, ARRAY['owner'])
    )
  );

CREATE POLICY "campaign_members_delete_owner" ON public.campaign_members FOR DELETE
  USING (
    EXISTS (
      SELECT 1 FROM public.campaigns c
      WHERE c.id = campaign_id
        AND public.has_universe_role(c.universe_id, ARRAY['owner'])
    )
  );


-- ══════════════════════════════════════════════════════════════
-- 6. RLS — tables de contenu (visibilité scoped par campagne)
-- ══════════════════════════════════════════════════════════════

-- Personnages : lecture propriétaire OU public+campagne commune.
DROP POLICY IF EXISTS "characters_select" ON public.characters;
CREATE POLICY "characters_select" ON public.characters FOR SELECT
  USING (
    auth.uid() = user_id
    OR (is_public = TRUE AND public.shares_campaign_with(universe_id, user_id, auth.uid()))
  );

-- Édition : propriétaire OU utilisateur ayant accès (même règle que
-- la lecture) — reprend le comportement existant qui autorisait déjà
-- l'édition collaborative d'un personnage partagé, désormais rebasé
-- sur la co-appartenance à une campagne plutôt que sur un "follow".
DROP POLICY IF EXISTS "characters_update" ON public.characters;
CREATE POLICY "characters_update" ON public.characters FOR UPDATE
  USING (
    auth.uid() = user_id
    OR (is_public = TRUE AND public.shares_campaign_with(universe_id, user_id, auth.uid()))
  );

-- Chroniques
DROP POLICY IF EXISTS "chronicles_select" ON public.chronicles;
CREATE POLICY "chronicles_select" ON public.chronicles FOR SELECT
  USING (
    auth.uid() = user_id
    OR (is_public = TRUE AND public.shares_campaign_with(universe_id, user_id, auth.uid()))
  );

DROP POLICY IF EXISTS "entries_select" ON public.chronicle_entries;
CREATE POLICY "entries_select" ON public.chronicle_entries FOR SELECT
  USING (EXISTS (
    SELECT 1 FROM public.chronicles c
    WHERE c.id = chronicle_id
      AND (
        c.user_id = auth.uid()
        OR (c.is_public = TRUE AND public.shares_campaign_with(c.universe_id, c.user_id, auth.uid()))
      )
  ));

-- Documents
DROP POLICY IF EXISTS "documents_select" ON public.documents;
CREATE POLICY "documents_select" ON public.documents FOR SELECT
  USING (
    auth.uid() = user_id
    OR (is_public = TRUE AND public.shares_campaign_with(universe_id, user_id, auth.uid()))
  );

DROP POLICY IF EXISTS "documents_update" ON public.documents;
CREATE POLICY "documents_update" ON public.documents FOR UPDATE
  USING (
    auth.uid() = user_id
    OR (
      allow_write_share = TRUE
      AND is_public = TRUE
      AND public.shares_campaign_with(universe_id, user_id, auth.uid())
    )
  )
  WITH CHECK (
    auth.uid() = user_id
    OR (
      allow_write_share = TRUE
      AND is_public = TRUE
      AND public.shares_campaign_with(universe_id, user_id, auth.uid())
    )
  );

-- Couches de carte
DROP POLICY IF EXISTS "map_layers_select" ON public.map_layers;
CREATE POLICY "map_layers_select" ON public.map_layers FOR SELECT
  USING (
    auth.uid() = user_id
    OR (is_public = TRUE AND public.shares_campaign_with(universe_id, user_id, auth.uid()))
  );

-- Marqueurs de carte : visibles si la couche correspondante
-- (même user_id + map_key) est publique et partagée via campagne.
DROP POLICY IF EXISTS "map_markers_select_followed" ON public.map_markers;
CREATE POLICY "map_markers_select_shared" ON public.map_markers FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.map_layers ml
      WHERE ml.user_id  = map_markers.user_id
        AND ml.map_key  = map_markers.map_key
        AND ml.is_public = TRUE
        AND public.shares_campaign_with(ml.universe_id, ml.user_id, auth.uid())
    )
  );

-- Notes secrètes sur un personnage : on ne peut en écrire une que
-- sur un personnage qu'on peut voir (propriétaire ou public+campagne).
DROP POLICY IF EXISTS "character_secrets_own_notes" ON public.character_secrets;
CREATE POLICY "character_secrets_own_notes" ON public.character_secrets FOR ALL
  USING (user_id = auth.uid())
  WITH CHECK (
    user_id = auth.uid()
    AND EXISTS (
      SELECT 1 FROM public.characters c
      WHERE c.id = character_id
        AND (
          c.user_id = auth.uid()
          OR (c.is_public = TRUE AND public.shares_campaign_with(c.universe_id, c.user_id, auth.uid()))
        )
    )
  );

-- Note : les policies "*_select_anon" (lecture par lien public sans
-- compte, sur characters/chronicles/chronicle_entries/documents/
-- map_layers/map_markers) sont laissées inchangées — elles sont
-- orthogonales au partage inter-utilisateurs de l'univers. Elles
-- deviennent simplement inatteignables une fois l'UI de génération
-- de lien retirée côté frontend.


-- ══════════════════════════════════════════════════════════════
-- 7. transfer_item : recherche par id au lieu de share_code
-- ══════════════════════════════════════════════════════════════

DROP FUNCTION IF EXISTS public.transfer_item(TEXT, TEXT, TEXT);

CREATE OR REPLACE FUNCTION public.transfer_item(
  p_item_type   TEXT,   -- 'char' | 'chr' | 'doc' | 'map'
  p_item_id     UUID,
  p_to_username TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_caller_id    UUID := auth.uid();
  v_target_id    UUID;
  v_item_user_id UUID;
  v_map_key      TEXT;
BEGIN
  IF v_caller_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'not_authenticated');
  END IF;

  SELECT id INTO v_target_id
  FROM public.profiles
  WHERE lower(username) = lower(trim(p_to_username))
  LIMIT 1;

  IF v_target_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'user_not_found');
  END IF;

  IF v_target_id = v_caller_id THEN
    RETURN jsonb_build_object('ok', false, 'error', 'same_user');
  END IF;

  IF p_item_type = 'char' THEN
    SELECT user_id INTO v_item_user_id FROM public.characters WHERE id = p_item_id;
    IF v_item_user_id IS NULL THEN RETURN jsonb_build_object('ok', false, 'error', 'item_not_found'); END IF;
    IF v_item_user_id <> v_caller_id THEN RETURN jsonb_build_object('ok', false, 'error', 'not_owner'); END IF;
    PERFORM public._cleanup_char_tags_on_transfer(p_item_id, v_caller_id);
    UPDATE public.characters SET user_id = v_target_id, updated_at = NOW() WHERE id = p_item_id;

  ELSIF p_item_type = 'chr' THEN
    SELECT user_id INTO v_item_user_id FROM public.chronicles WHERE id = p_item_id;
    IF v_item_user_id IS NULL THEN RETURN jsonb_build_object('ok', false, 'error', 'item_not_found'); END IF;
    IF v_item_user_id <> v_caller_id THEN RETURN jsonb_build_object('ok', false, 'error', 'not_owner'); END IF;
    UPDATE public.chronicles SET user_id = v_target_id, updated_at = NOW() WHERE id = p_item_id;

  ELSIF p_item_type = 'doc' THEN
    SELECT user_id INTO v_item_user_id FROM public.documents WHERE id = p_item_id;
    IF v_item_user_id IS NULL THEN RETURN jsonb_build_object('ok', false, 'error', 'item_not_found'); END IF;
    IF v_item_user_id <> v_caller_id THEN RETURN jsonb_build_object('ok', false, 'error', 'not_owner'); END IF;
    PERFORM public._cleanup_doc_tags_on_transfer(p_item_id, v_caller_id);
    UPDATE public.documents SET user_id = v_target_id, updated_at = NOW() WHERE id = p_item_id;

  ELSIF p_item_type = 'map' THEN
    SELECT user_id, map_key INTO v_item_user_id, v_map_key FROM public.map_layers WHERE id = p_item_id;
    IF v_item_user_id IS NULL THEN RETURN jsonb_build_object('ok', false, 'error', 'item_not_found'); END IF;
    IF v_item_user_id <> v_caller_id THEN RETURN jsonb_build_object('ok', false, 'error', 'not_owner'); END IF;
    -- Transfère uniquement les marqueurs de la carte concernée (comme avant).
    UPDATE public.map_markers
      SET user_id = v_target_id, updated_at = NOW()
      WHERE user_id = v_caller_id AND map_key = v_map_key;
    UPDATE public.map_layers
      SET user_id = v_target_id, updated_at = NOW()
      WHERE id = p_item_id;

  ELSE
    RETURN jsonb_build_object('ok', false, 'error', 'invalid_type');
  END IF;

  RETURN jsonb_build_object('ok', true, 'item_id', p_item_id, 'to_user_id', v_target_id);
END;
$$;

GRANT EXECUTE ON FUNCTION public.transfer_item(TEXT, UUID, TEXT) TO authenticated;

-- Note : le type 'campaign' n'est plus transférable — une campagne
-- appartient structurellement au propriétaire de l'univers, qui est
-- seul habilité à en créer et à en gérer les membres.

-- ══════════════════════════════════════════════════════════════
-- Fin — voir campaigns.js / scripts.js / chronicles.js / documents.js
-- / map.js / transfert.js / index.html pour la partie frontend
-- correspondante (requêtes rebasées sur universe_id + id, plus de
-- share_code ni de flux "suivre par code").
-- ══════════════════════════════════════════════════════════════
