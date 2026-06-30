-- ══════════════════════════════════════════════════════════════
-- CAMPLY — Migration : Support multi-cartes
-- À exécuter dans Supabase Dashboard > SQL Editor > New query
-- ══════════════════════════════════════════════════════════════
--
-- Changements :
--  1. Ajout de map_key sur map_markers → lie un marqueur à une
--     carte spécifique du fichier de configuration.
--  2. Ajout de map_key sur map_layers → une couche partageable
--     par carte (et non plus une seule couche par utilisateur).
--  3. Suppression de UNIQUE(user_id) sur map_layers, remplacée
--     par UNIQUE(user_id, map_key).
--  4. Mise à jour de transfer_item pour transférer uniquement
--     les marqueurs de la carte concernée.
-- ══════════════════════════════════════════════════════════════


-- ── 1. Colonne map_key sur map_markers ───────────────────────
-- 'default' pour les marqueurs existants (compatibilité).

ALTER TABLE public.map_markers
  ADD COLUMN IF NOT EXISTS map_key TEXT NOT NULL DEFAULT 'default';

CREATE INDEX IF NOT EXISTS map_markers_user_map_idx
  ON public.map_markers(user_id, map_key);


-- ── 2. Colonne map_key sur map_layers ────────────────────────

ALTER TABLE public.map_layers
  ADD COLUMN IF NOT EXISTS map_key TEXT NOT NULL DEFAULT 'default';

-- Supprime l'ancienne contrainte UNIQUE(user_id)
ALTER TABLE public.map_layers
  DROP CONSTRAINT IF EXISTS map_layers_user_id_key;

-- Nouvelle contrainte : une couche par utilisateur par carte
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'map_layers_user_id_map_key_key'
      AND conrelid = 'public.map_layers'::regclass
  ) THEN
    ALTER TABLE public.map_layers
      ADD CONSTRAINT map_layers_user_id_map_key_key UNIQUE (user_id, map_key);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS map_layers_map_key_idx
  ON public.map_layers(map_key);


-- ── 3. Mise à jour transfer_item — type 'map' ─────────────────
-- Transfert uniquement les marqueurs de la carte concernée
-- (et non plus TOUS les marqueurs de l'utilisateur).

CREATE OR REPLACE FUNCTION public.transfer_item(
  p_item_type   TEXT,
  p_share_code  TEXT,
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
  v_item_id      UUID;
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

  -- ── CAS : personnage ────────────────────────────────────────
  IF p_item_type = 'char' THEN
    SELECT id, user_id INTO v_item_id, v_item_user_id
    FROM public.characters WHERE share_code = upper(trim(p_share_code)) LIMIT 1;
    IF v_item_id IS NULL THEN RETURN jsonb_build_object('ok', false, 'error', 'item_not_found'); END IF;
    IF v_item_user_id <> v_caller_id THEN RETURN jsonb_build_object('ok', false, 'error', 'not_owner'); END IF;
    PERFORM public._cleanup_char_tags_on_transfer(v_item_id, v_caller_id);
    DELETE FROM public.followed_characters WHERE character_id = v_item_id AND user_id = v_caller_id;
    DELETE FROM public.followed_characters WHERE character_id = v_item_id AND user_id = v_target_id;
    UPDATE public.characters SET user_id = v_target_id, updated_at = NOW() WHERE id = v_item_id;
    INSERT INTO public.followed_characters (user_id, character_id) VALUES (v_caller_id, v_item_id) ON CONFLICT DO NOTHING;

  -- ── CAS : chronique ─────────────────────────────────────────
  ELSIF p_item_type = 'chr' THEN
    SELECT id, user_id INTO v_item_id, v_item_user_id
    FROM public.chronicles WHERE share_code = upper(trim(p_share_code)) LIMIT 1;
    IF v_item_id IS NULL THEN RETURN jsonb_build_object('ok', false, 'error', 'item_not_found'); END IF;
    IF v_item_user_id <> v_caller_id THEN RETURN jsonb_build_object('ok', false, 'error', 'not_owner'); END IF;
    DELETE FROM public.followed_chronicles WHERE chronicle_id = v_item_id AND user_id = v_caller_id;
    DELETE FROM public.followed_chronicles WHERE chronicle_id = v_item_id AND user_id = v_target_id;
    UPDATE public.chronicles SET user_id = v_target_id, updated_at = NOW() WHERE id = v_item_id;
    INSERT INTO public.followed_chronicles (user_id, chronicle_id) VALUES (v_caller_id, v_item_id) ON CONFLICT DO NOTHING;

  -- ── CAS : document ──────────────────────────────────────────
  ELSIF p_item_type = 'doc' THEN
    SELECT id, user_id INTO v_item_id, v_item_user_id
    FROM public.documents WHERE share_code = upper(trim(p_share_code)) LIMIT 1;
    IF v_item_id IS NULL THEN RETURN jsonb_build_object('ok', false, 'error', 'item_not_found'); END IF;
    IF v_item_user_id <> v_caller_id THEN RETURN jsonb_build_object('ok', false, 'error', 'not_owner'); END IF;
    PERFORM public._cleanup_doc_tags_on_transfer(v_item_id, v_caller_id);
    DELETE FROM public.followed_documents WHERE document_id = v_item_id AND user_id = v_caller_id;
    DELETE FROM public.followed_documents WHERE document_id = v_item_id AND user_id = v_target_id;
    UPDATE public.documents SET user_id = v_target_id, updated_at = NOW() WHERE id = v_item_id;
    INSERT INTO public.followed_documents (user_id, document_id) VALUES (v_caller_id, v_item_id) ON CONFLICT DO NOTHING;

  -- ── CAS : campagne ──────────────────────────────────────────
  ELSIF p_item_type = 'campaign' THEN
    SELECT id, user_id INTO v_item_id, v_item_user_id
    FROM public.campaigns WHERE share_code = upper(trim(p_share_code)) LIMIT 1;
    IF v_item_id IS NULL THEN RETURN jsonb_build_object('ok', false, 'error', 'item_not_found'); END IF;
    IF v_item_user_id <> v_caller_id THEN RETURN jsonb_build_object('ok', false, 'error', 'not_owner'); END IF;
    DELETE FROM public.followed_campaigns WHERE campaign_id = v_item_id AND user_id = v_caller_id;
    DELETE FROM public.followed_campaigns WHERE campaign_id = v_item_id AND user_id = v_target_id;
    UPDATE public.campaigns SET user_id = v_target_id, updated_at = NOW() WHERE id = v_item_id;
    INSERT INTO public.followed_campaigns (user_id, campaign_id) VALUES (v_caller_id, v_item_id) ON CONFLICT DO NOTHING;

  -- ── CAS : couche de carte ────────────────────────────────────
  ELSIF p_item_type = 'map' THEN
    SELECT id, user_id, map_key INTO v_item_id, v_item_user_id, v_map_key
    FROM public.map_layers WHERE share_code = upper(trim(p_share_code)) LIMIT 1;
    IF v_item_id IS NULL THEN RETURN jsonb_build_object('ok', false, 'error', 'item_not_found'); END IF;
    IF v_item_user_id <> v_caller_id THEN RETURN jsonb_build_object('ok', false, 'error', 'not_owner'); END IF;
    DELETE FROM public.followed_map_layers WHERE layer_id = v_item_id AND user_id = v_caller_id;
    DELETE FROM public.followed_map_layers WHERE layer_id = v_item_id AND user_id = v_target_id;
    -- Transfère uniquement les marqueurs de la carte concernée
    UPDATE public.map_markers
      SET user_id = v_target_id, updated_at = NOW()
      WHERE user_id = v_caller_id AND map_key = v_map_key;
    UPDATE public.map_layers
      SET user_id = v_target_id, updated_at = NOW()
      WHERE id = v_item_id;
    INSERT INTO public.followed_map_layers (user_id, layer_id) VALUES (v_caller_id, v_item_id) ON CONFLICT DO NOTHING;

  ELSE
    RETURN jsonb_build_object('ok', false, 'error', 'invalid_type');
  END IF;

  RETURN jsonb_build_object('ok', true, 'item_id', v_item_id, 'to_user_id', v_target_id);
END;
$$;

GRANT EXECUTE ON FUNCTION public.transfer_item(TEXT, TEXT, TEXT) TO authenticated;

-- ══════════════════════════════════════════════════════════════
-- Résumé :
--  • map_markers.map_key → identifie quelle carte (défaut 'default')
--  • map_layers.map_key  → une couche par carte par utilisateur
--  • UNIQUE(user_id, map_key) remplace UNIQUE(user_id)
--  • transfer_item 'map' ne transfère que les marqueurs de la
--    carte concernée, pas tous les marqueurs de l'utilisateur
--
-- Note : les marqueurs et couches existants reçoivent map_key
-- = 'default'. Assurez-vous que la première entrée de votre
-- MAP_CONFIG.maps a key: 'default', ou remplacez les valeurs
-- avec : UPDATE map_markers SET map_key = 'votre_cle';
-- ══════════════════════════════════════════════════════════════
