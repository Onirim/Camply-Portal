-- Camply Portal — Phase 1: structure multi-univers
-- À exécuter sur une base vide après sql/00_fresh_install.sql.
-- Ce script ne migre pas les données existantes: il ajoute le modèle Univers
-- et rend les codes de partage uniques à l'intérieur d'un univers.

-- ══════════════════════════════════════════════════════════════
-- 1. Helpers communs
-- ══════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.generate_short_code()
RETURNS TEXT
LANGUAGE plpgsql
AS $$
DECLARE
  chars TEXT := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  result TEXT := '';
  i INT;
BEGIN
  FOR i IN 1..8 LOOP
    result := result || substr(chars, floor(random() * length(chars) + 1)::INT, 1);
  END LOOP;
  RETURN result;
END;
$$;

-- ══════════════════════════════════════════════════════════════
-- 2. Univers et membres
-- ══════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS public.universes (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id    UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name        TEXT NOT NULL CHECK (length(trim(name)) > 0),
  description TEXT NOT NULL DEFAULT '',
  join_code   CHAR(8) UNIQUE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS universes_owner_idx ON public.universes(owner_id);
CREATE INDEX IF NOT EXISTS universes_join_code_idx ON public.universes(join_code) WHERE join_code IS NOT NULL;

DROP TRIGGER IF EXISTS on_universes_updated ON public.universes;
CREATE TRIGGER on_universes_updated
  BEFORE UPDATE ON public.universes
  FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

CREATE OR REPLACE FUNCTION public.set_universe_join_code()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  new_code TEXT;
  attempts INT := 0;
BEGIN
  IF NEW.join_code IS NULL THEN
    LOOP
      new_code := public.generate_short_code();
      EXIT WHEN NOT EXISTS (
        SELECT 1 FROM public.universes u WHERE u.join_code = new_code
      );
      attempts := attempts + 1;
      IF attempts > 100 THEN
        RAISE EXCEPTION 'Could not generate unique universe join_code';
      END IF;
    END LOOP;
    NEW.join_code := new_code;
  ELSE
    NEW.join_code := upper(trim(NEW.join_code));
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS set_universe_join_code ON public.universes;
CREATE TRIGGER set_universe_join_code
  BEFORE INSERT ON public.universes
  FOR EACH ROW EXECUTE FUNCTION public.set_universe_join_code();

CREATE TABLE IF NOT EXISTS public.universe_members (
  universe_id UUID NOT NULL REFERENCES public.universes(id) ON DELETE CASCADE,
  user_id     UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role        TEXT NOT NULL CHECK (role IN ('owner', 'admin', 'player', 'viewer')),
  joined_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (universe_id, user_id)
);

CREATE INDEX IF NOT EXISTS universe_members_user_idx ON public.universe_members(user_id);
CREATE INDEX IF NOT EXISTS universe_members_role_idx ON public.universe_members(universe_id, role);

CREATE OR REPLACE FUNCTION public.is_universe_member(p_universe_id UUID, p_user_id UUID DEFAULT auth.uid())
RETURNS BOOLEAN
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.universe_members um
    WHERE um.universe_id = p_universe_id
      AND um.user_id = p_user_id
  );
$$;

CREATE OR REPLACE FUNCTION public.has_universe_role(
  p_universe_id UUID,
  p_roles TEXT[],
  p_user_id UUID DEFAULT auth.uid()
)
RETURNS BOOLEAN
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.universe_members um
    WHERE um.universe_id = p_universe_id
      AND um.user_id = p_user_id
      AND um.role = ANY(p_roles)
  );
$$;

CREATE OR REPLACE FUNCTION public.create_universe(p_name TEXT, p_description TEXT DEFAULT '')
RETURNS public.universes
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  created_universe public.universes;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;

  INSERT INTO public.universes (owner_id, name, description)
  VALUES (auth.uid(), trim(p_name), COALESCE(p_description, ''))
  RETURNING * INTO created_universe;

  INSERT INTO public.universe_members (universe_id, user_id, role)
  VALUES (created_universe.id, auth.uid(), 'owner')
  ON CONFLICT (universe_id, user_id) DO UPDATE SET role = 'owner';

  RETURN created_universe;
END;
$$;

GRANT EXECUTE ON FUNCTION public.create_universe(TEXT, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_universe_member(UUID, UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.has_universe_role(UUID, TEXT[], UUID) TO authenticated;

-- ══════════════════════════════════════════════════════════════
-- 3. Colonnes universe_id sur les entités métier
-- ══════════════════════════════════════════════════════════════
-- Base vide attendue: les colonnes sont NOT NULL pour éviter toute donnée orpheline.

ALTER TABLE public.characters
  ADD COLUMN IF NOT EXISTS universe_id UUID NOT NULL REFERENCES public.universes(id) ON DELETE CASCADE;

ALTER TABLE public.tags
  ADD COLUMN IF NOT EXISTS universe_id UUID NOT NULL REFERENCES public.universes(id) ON DELETE CASCADE;

ALTER TABLE public.followed_characters
  ADD COLUMN IF NOT EXISTS universe_id UUID NOT NULL REFERENCES public.universes(id) ON DELETE CASCADE;

ALTER TABLE public.followed_character_tags
  ADD COLUMN IF NOT EXISTS universe_id UUID NOT NULL REFERENCES public.universes(id) ON DELETE CASCADE;

ALTER TABLE public.character_secrets
  ADD COLUMN IF NOT EXISTS universe_id UUID NOT NULL REFERENCES public.universes(id) ON DELETE CASCADE;

ALTER TABLE public.chronicles
  ADD COLUMN IF NOT EXISTS universe_id UUID NOT NULL REFERENCES public.universes(id) ON DELETE CASCADE;

ALTER TABLE public.followed_chronicles
  ADD COLUMN IF NOT EXISTS universe_id UUID NOT NULL REFERENCES public.universes(id) ON DELETE CASCADE;

ALTER TABLE public.documents
  ADD COLUMN IF NOT EXISTS universe_id UUID NOT NULL REFERENCES public.universes(id) ON DELETE CASCADE;

ALTER TABLE public.doc_tags
  ADD COLUMN IF NOT EXISTS universe_id UUID NOT NULL REFERENCES public.universes(id) ON DELETE CASCADE;

ALTER TABLE public.followed_documents
  ADD COLUMN IF NOT EXISTS universe_id UUID NOT NULL REFERENCES public.universes(id) ON DELETE CASCADE;

ALTER TABLE public.followed_document_tags
  ADD COLUMN IF NOT EXISTS universe_id UUID NOT NULL REFERENCES public.universes(id) ON DELETE CASCADE;

ALTER TABLE public.campaigns
  ADD COLUMN IF NOT EXISTS universe_id UUID NOT NULL REFERENCES public.universes(id) ON DELETE CASCADE;

ALTER TABLE public.followed_campaigns
  ADD COLUMN IF NOT EXISTS universe_id UUID NOT NULL REFERENCES public.universes(id) ON DELETE CASCADE;

ALTER TABLE public.map_markers
  ADD COLUMN IF NOT EXISTS universe_id UUID NOT NULL REFERENCES public.universes(id) ON DELETE CASCADE;

ALTER TABLE public.map_layers
  ADD COLUMN IF NOT EXISTS universe_id UUID NOT NULL REFERENCES public.universes(id) ON DELETE CASCADE;

ALTER TABLE public.followed_map_layers
  ADD COLUMN IF NOT EXISTS universe_id UUID NOT NULL REFERENCES public.universes(id) ON DELETE CASCADE;

ALTER TABLE public.read_markers
  ADD COLUMN IF NOT EXISTS universe_id UUID NOT NULL REFERENCES public.universes(id) ON DELETE CASCADE;

-- ══════════════════════════════════════════════════════════════
-- 4. Index de filtrage par univers
-- ══════════════════════════════════════════════════════════════

CREATE INDEX IF NOT EXISTS characters_universe_user_idx ON public.characters(universe_id, user_id);
CREATE INDEX IF NOT EXISTS tags_universe_user_idx ON public.tags(universe_id, user_id);
CREATE INDEX IF NOT EXISTS followed_characters_universe_user_idx ON public.followed_characters(universe_id, user_id);
CREATE INDEX IF NOT EXISTS followed_character_tags_universe_user_idx ON public.followed_character_tags(universe_id, user_id);
CREATE INDEX IF NOT EXISTS character_secrets_universe_user_idx ON public.character_secrets(universe_id, user_id);

CREATE INDEX IF NOT EXISTS chronicles_universe_user_idx ON public.chronicles(universe_id, user_id);
CREATE INDEX IF NOT EXISTS followed_chronicles_universe_user_idx ON public.followed_chronicles(universe_id, user_id);
CREATE INDEX IF NOT EXISTS documents_universe_user_idx ON public.documents(universe_id, user_id);
CREATE INDEX IF NOT EXISTS doc_tags_universe_user_idx ON public.doc_tags(universe_id, user_id);
CREATE INDEX IF NOT EXISTS followed_documents_universe_user_idx ON public.followed_documents(universe_id, user_id);
CREATE INDEX IF NOT EXISTS followed_document_tags_universe_user_idx ON public.followed_document_tags(universe_id, user_id);

CREATE INDEX IF NOT EXISTS campaigns_universe_user_idx ON public.campaigns(universe_id, user_id);
CREATE INDEX IF NOT EXISTS followed_campaigns_universe_user_idx ON public.followed_campaigns(universe_id, user_id);
CREATE INDEX IF NOT EXISTS map_markers_universe_user_map_idx ON public.map_markers(universe_id, user_id, map_key);
CREATE INDEX IF NOT EXISTS map_layers_universe_user_map_idx ON public.map_layers(universe_id, user_id, map_key);
CREATE INDEX IF NOT EXISTS followed_map_layers_universe_user_idx ON public.followed_map_layers(universe_id, user_id);
CREATE INDEX IF NOT EXISTS read_markers_universe_user_idx ON public.read_markers(universe_id, user_id);

-- ══════════════════════════════════════════════════════════════
-- 5. Codes de partage internes aux univers
-- ══════════════════════════════════════════════════════════════
-- Les anciens UNIQUE globaux sont supprimés si leur nom standard existe,
-- puis remplacés par des contraintes/index composites par univers.

ALTER TABLE public.characters DROP CONSTRAINT IF EXISTS characters_share_code_key;
ALTER TABLE public.chronicles DROP CONSTRAINT IF EXISTS chronicles_share_code_key;
ALTER TABLE public.documents DROP CONSTRAINT IF EXISTS documents_share_code_key;
ALTER TABLE public.map_layers DROP CONSTRAINT IF EXISTS map_layers_share_code_key;
DROP INDEX IF EXISTS public.campaigns_share_code_idx;

CREATE UNIQUE INDEX IF NOT EXISTS characters_universe_share_code_idx
  ON public.characters(universe_id, share_code) WHERE share_code IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS chronicles_universe_share_code_idx
  ON public.chronicles(universe_id, share_code) WHERE share_code IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS documents_universe_share_code_idx
  ON public.documents(universe_id, share_code) WHERE share_code IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS campaigns_universe_share_code_idx
  ON public.campaigns(universe_id, share_code) WHERE share_code IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS map_layers_universe_share_code_idx
  ON public.map_layers(universe_id, share_code) WHERE share_code IS NOT NULL;

-- Tags: les noms restent personnels, mais seulement dans l'univers courant.
ALTER TABLE public.tags DROP CONSTRAINT IF EXISTS tags_user_id_name_key;
ALTER TABLE public.doc_tags DROP CONSTRAINT IF EXISTS doc_tags_user_id_name_key;
ALTER TABLE public.tags ADD CONSTRAINT tags_universe_user_name_key UNIQUE (universe_id, user_id, name);
ALTER TABLE public.doc_tags ADD CONSTRAINT doc_tags_universe_user_name_key UNIQUE (universe_id, user_id, name);

-- Abonnements: un même objet ne peut être suivi qu'une fois par utilisateur dans un univers.
ALTER TABLE public.followed_characters DROP CONSTRAINT IF EXISTS followed_characters_pkey;
ALTER TABLE public.followed_characters ADD PRIMARY KEY (universe_id, user_id, character_id);
ALTER TABLE public.followed_chronicles DROP CONSTRAINT IF EXISTS followed_chronicles_pkey;
ALTER TABLE public.followed_chronicles ADD PRIMARY KEY (universe_id, user_id, chronicle_id);
ALTER TABLE public.followed_documents DROP CONSTRAINT IF EXISTS followed_documents_pkey;
ALTER TABLE public.followed_documents ADD PRIMARY KEY (universe_id, user_id, document_id);
ALTER TABLE public.followed_campaigns DROP CONSTRAINT IF EXISTS followed_campaigns_pkey;
ALTER TABLE public.followed_campaigns ADD PRIMARY KEY (universe_id, user_id, campaign_id);
ALTER TABLE public.followed_map_layers DROP CONSTRAINT IF EXISTS followed_map_layers_pkey;
ALTER TABLE public.followed_map_layers ADD PRIMARY KEY (universe_id, user_id, layer_id);

ALTER TABLE public.followed_character_tags DROP CONSTRAINT IF EXISTS followed_character_tags_pkey;
ALTER TABLE public.followed_character_tags DROP CONSTRAINT IF EXISTS followed_character_tags_user_id_character_id_tag_id_key;
ALTER TABLE public.followed_character_tags ADD PRIMARY KEY (universe_id, user_id, character_id, tag_id);
ALTER TABLE public.followed_document_tags DROP CONSTRAINT IF EXISTS followed_document_tags_pkey;
ALTER TABLE public.followed_document_tags ADD PRIMARY KEY (universe_id, user_id, document_id, tag_id);

ALTER TABLE public.character_secrets DROP CONSTRAINT IF EXISTS character_secrets_pkey;
ALTER TABLE public.character_secrets ADD PRIMARY KEY (universe_id, character_id, user_id);

ALTER TABLE public.read_markers DROP CONSTRAINT IF EXISTS read_markers_pkey;
ALTER TABLE public.read_markers ADD PRIMARY KEY (universe_id, user_id, content_type, content_id);

-- Une couche de carte par utilisateur, par carte, par univers.
ALTER TABLE public.map_layers DROP CONSTRAINT IF EXISTS map_layers_user_id_key;
ALTER TABLE public.map_layers DROP CONSTRAINT IF EXISTS map_layers_user_id_map_key_key;
ALTER TABLE public.map_layers ADD CONSTRAINT map_layers_universe_user_map_key UNIQUE (universe_id, user_id, map_key);

-- Les campagnes peuvent contenir des cartes; la contrainte finale du fresh install
-- peut déjà le permettre, mais on force ici le modèle cible.
ALTER TABLE public.campaign_items DROP CONSTRAINT IF EXISTS campaign_items_item_type_check;
ALTER TABLE public.campaign_items
  ADD CONSTRAINT campaign_items_item_type_check CHECK (item_type IN ('char', 'chr', 'doc', 'map'));



-- Génération de codes de partage dans le périmètre de l'univers.
CREATE OR REPLACE FUNCTION public.generate_share_code()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  new_code TEXT;
  attempts INT := 0;
  already_exists BOOLEAN;
BEGIN
  IF NEW.share_code IS NOT NULL THEN
    NEW.share_code := upper(trim(NEW.share_code));
    RETURN NEW;
  END IF;

  IF NEW.universe_id IS NULL THEN
    RAISE EXCEPTION 'universe_id is required to generate a share_code';
  END IF;

  LOOP
    new_code := public.generate_short_code();
    EXECUTE format(
      'SELECT EXISTS (SELECT 1 FROM %I.%I WHERE universe_id = $1 AND share_code = $2)',
      TG_TABLE_SCHEMA,
      TG_TABLE_NAME
    )
    INTO already_exists
    USING NEW.universe_id, new_code;

    EXIT WHEN NOT already_exists;
    attempts := attempts + 1;
    IF attempts > 100 THEN
      RAISE EXCEPTION 'Could not generate unique share_code for %.%', TG_TABLE_SCHEMA, TG_TABLE_NAME;
    END IF;
  END LOOP;

  NEW.share_code := new_code;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.generate_campaign_share_code()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  new_code CHAR(8);
  attempts INT := 0;
BEGIN
  IF NEW.is_public = TRUE
     AND NEW.share_code IS NULL
     AND (TG_OP = 'INSERT' OR COALESCE(OLD.is_public, FALSE) = FALSE) THEN
    IF NEW.universe_id IS NULL THEN
      RAISE EXCEPTION 'universe_id is required to generate a campaign share_code';
    END IF;

    LOOP
      new_code := public.generate_short_code();
      EXIT WHEN NOT EXISTS (
        SELECT 1
        FROM public.campaigns c
        WHERE c.universe_id = NEW.universe_id
          AND c.share_code = new_code
      );
      attempts := attempts + 1;
      IF attempts > 100 THEN
        RAISE EXCEPTION 'Could not generate unique campaign share_code';
      END IF;
    END LOOP;

    NEW.share_code := new_code;
  ELSIF NEW.share_code IS NOT NULL THEN
    NEW.share_code := upper(trim(NEW.share_code));
  END IF;

  NEW.updated_at := NOW();
  RETURN NEW;
END;
$$;

-- ══════════════════════════════════════════════════════════════
-- 6. RLS univers / membres
-- ══════════════════════════════════════════════════════════════

ALTER TABLE public.universes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.universe_members ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "universes_select_member" ON public.universes;
CREATE POLICY "universes_select_member"
  ON public.universes FOR SELECT
  USING (public.is_universe_member(id));

DROP POLICY IF EXISTS "universes_insert_owner" ON public.universes;
CREATE POLICY "universes_insert_owner"
  ON public.universes FOR INSERT
  WITH CHECK (owner_id = auth.uid());

DROP POLICY IF EXISTS "universes_update_admin" ON public.universes;
CREATE POLICY "universes_update_admin"
  ON public.universes FOR UPDATE
  USING (public.has_universe_role(id, ARRAY['owner','admin']))
  WITH CHECK (public.has_universe_role(id, ARRAY['owner','admin']));

DROP POLICY IF EXISTS "universes_delete_owner" ON public.universes;
CREATE POLICY "universes_delete_owner"
  ON public.universes FOR DELETE
  USING (owner_id = auth.uid() OR public.has_universe_role(id, ARRAY['owner']));

DROP POLICY IF EXISTS "universe_members_select_same_universe" ON public.universe_members;
CREATE POLICY "universe_members_select_same_universe"
  ON public.universe_members FOR SELECT
  USING (public.is_universe_member(universe_id));

DROP POLICY IF EXISTS "universe_members_insert_admin" ON public.universe_members;
CREATE POLICY "universe_members_insert_admin"
  ON public.universe_members FOR INSERT
  WITH CHECK (public.has_universe_role(universe_id, ARRAY['owner','admin']));

DROP POLICY IF EXISTS "universe_members_update_admin" ON public.universe_members;
CREATE POLICY "universe_members_update_admin"
  ON public.universe_members FOR UPDATE
  USING (public.has_universe_role(universe_id, ARRAY['owner','admin']))
  WITH CHECK (public.has_universe_role(universe_id, ARRAY['owner','admin']));

DROP POLICY IF EXISTS "universe_members_delete_admin_or_self" ON public.universe_members;
CREATE POLICY "universe_members_delete_admin_or_self"
  ON public.universe_members FOR DELETE
  USING (
    user_id = auth.uid()
    OR public.has_universe_role(universe_id, ARRAY['owner','admin'])
  );

-- ══════════════════════════════════════════════════════════════
-- 7. Notes d'intégration pour la phase JS
-- ══════════════════════════════════════════════════════════════
-- À partir de ce schéma, tous les INSERT front devront fournir universe_id,
-- et tous les SELECT/UPDATE/DELETE devront être filtrés par currentUniverse.id.
-- Les policies métier détaillées des tables de contenu seront durcies en phase 2,
-- lorsque le front enverra systématiquement universe_id.
