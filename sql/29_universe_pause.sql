-- ══════════════════════════════════════════════════════════════
-- Camply — Mise en pause des univers inactifs
-- À coller dans : Supabase Dashboard > SQL Editor > New query
--
-- Un univers que personne n'a visité depuis 2 mois est mis en
-- pause : toutes ses données (personnages, chroniques, documents,
-- campagnes, cartes...) sont sérialisées dans un unique blob JSONB
-- de public.universe_archives — compressé automatiquement par
-- Postgres via le mécanisme TOAST — puis supprimées des tables
-- vives. Seules la ligne universes (nom, illustration, badge
-- "en pause") et les lignes universe_members (accès, rôles)
-- restent en place.
--
-- La réactivation (resume_universe) réinsère toutes les lignes
-- archivées puis supprime l'archive. Tout est transactionnel :
-- en cas d'erreur, rien n'est perdu.
--
-- Les fonctions d'archivage sont génériques : elles découvrent via
-- le catalogue toute table portant une colonne universe_id (niveau 1)
-- ainsi que leurs tables filles sans universe_id (niveau 2, ex :
-- chronicle_entries, character_tags, campaign_members...). Une table
-- ajoutée par une future migration sera donc archivée automatiquement.
--
-- ⚠ Limite connue : si une future migration ajoute une colonne
-- NOT NULL sans DEFAULT-compatible à une table archivée, les archives
-- créées avant cette migration devront être backfillées avant
-- réactivation (jsonb_populate_recordset remplit les colonnes
-- manquantes avec NULL).
--
-- Déclenchement : pause_stale_universes() est appelée par le client
-- au chargement de la liste des univers et ne met en pause que les
-- univers POSSÉDÉS par l'appelant. touch_universe_visit() est appelée
-- à chaque entrée dans un univers (par n'importe quel membre).
-- ══════════════════════════════════════════════════════════════

BEGIN;

-- ── 1. Colonnes de suivi sur universes ──────────────────────────
-- DEFAULT NOW() : les univers existants partent avec une visite
-- "aujourd'hui" pour ne pas être mis en pause dès la migration.

ALTER TABLE public.universes
  ADD COLUMN IF NOT EXISTS last_visited_at TIMESTAMPTZ NOT NULL DEFAULT NOW();

ALTER TABLE public.universes
  ADD COLUMN IF NOT EXISTS paused_at TIMESTAMPTZ;


-- ── 2. Le trigger updated_at ignore les champs de suivi ─────────
-- Sans cela, chaque visite (last_visited_at) fausserait la date
-- "Modifié" affichée sur les cards et l'ordre de tri des univers.

CREATE OR REPLACE FUNCTION public.handle_universe_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF (to_jsonb(NEW) - 'updated_at' - 'last_visited_at' - 'paused_at')
     IS DISTINCT FROM
     (to_jsonb(OLD) - 'updated_at' - 'last_visited_at' - 'paused_at') THEN
    NEW.updated_at = NOW();
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_universes_updated ON public.universes;
CREATE TRIGGER on_universes_updated
  BEFORE UPDATE ON public.universes
  FOR EACH ROW EXECUTE FUNCTION public.handle_universe_updated_at();


-- ── 3. Table d'archives (stockage à froid) ──────────────────────
-- payload : { "nom_de_table": [ligne, ligne, ...], ... }
-- Les valeurs JSONB volumineuses sont compressées par TOAST.

CREATE TABLE IF NOT EXISTS public.universe_archives (
  universe_id UUID PRIMARY KEY REFERENCES public.universes(id) ON DELETE CASCADE,
  payload     JSONB NOT NULL,
  archived_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- RLS sans policy : la table n'est accessible que via les fonctions
-- SECURITY DEFINER ci-dessous, jamais directement par les clients.
ALTER TABLE public.universe_archives ENABLE ROW LEVEL SECURITY;


-- ── 4. Suivi des visites ────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.touch_universe_visit(p_universe_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;

  IF NOT public.is_universe_member(p_universe_id, auth.uid()) THEN
    RAISE EXCEPTION 'Seuls les membres de l''univers peuvent enregistrer une visite';
  END IF;

  UPDATE public.universes
  SET last_visited_at = NOW()
  WHERE id = p_universe_id;
END;
$$;


-- ── 5. Archivage (interne) ──────────────────────────────────────

CREATE OR REPLACE FUNCTION public._pause_universe_internal(p_universe_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_paused   TIMESTAMPTZ;
  v_payload  JSONB := '{}'::jsonb;
  v_tables   TEXT[];
  v_tbl      TEXT;
  v_rows     JSONB;
  v_child    RECORD;
BEGIN
  SELECT paused_at INTO v_paused
  FROM public.universes
  WHERE id = p_universe_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Univers introuvable';
  END IF;

  -- Déjà en pause : ne surtout pas écraser l'archive existante
  -- avec le contenu (vide) des tables vives.
  IF v_paused IS NOT NULL THEN
    RETURN;
  END IF;

  -- Niveau 1 : toute table de public portant une colonne universe_id.
  -- universes et universe_members restent en place (affichage de la
  -- card et droits d'accès), universe_archives est le conteneur.
  SELECT COALESCE(array_agg(c.table_name::text), '{}') INTO v_tables
  FROM information_schema.columns c
  JOIN information_schema.tables t
    ON t.table_schema = c.table_schema
   AND t.table_name   = c.table_name
   AND t.table_type   = 'BASE TABLE'
  WHERE c.table_schema = 'public'
    AND c.column_name  = 'universe_id'
    AND c.table_name NOT IN ('universes', 'universe_members', 'universe_archives');

  FOREACH v_tbl IN ARRAY v_tables LOOP
    EXECUTE format(
      'SELECT COALESCE(jsonb_agg(to_jsonb(t)), ''[]''::jsonb) FROM public.%I t WHERE t.universe_id = $1',
      v_tbl
    ) INTO v_rows USING p_universe_id;
    v_payload := v_payload || jsonb_build_object(v_tbl, v_rows);
  END LOOP;

  -- Niveau 2 : tables sans universe_id référençant une table de
  -- niveau 1 (ex : chronicle_entries → chronicles). Une seule FK
  -- suffit pour sélectionner les lignes de l'univers.
  FOR v_child IN
    SELECT DISTINCT ON (con.conrelid)
           con.conrelid::regclass::text  AS child_table,
           a.attname::text               AS fk_col,
           con.confrelid::regclass::text AS parent_table,
           pa.attname::text              AS parent_col
    FROM pg_constraint con
    JOIN pg_attribute a  ON a.attrelid  = con.conrelid  AND a.attnum  = con.conkey[1]
    JOIN pg_attribute pa ON pa.attrelid = con.confrelid AND pa.attnum = con.confkey[1]
    WHERE con.contype = 'f'
      AND array_length(con.conkey, 1) = 1
      AND con.conrelid::regclass::text  <> ALL (ARRAY['universes', 'universe_members', 'universe_archives'])
      AND con.confrelid::regclass::text =  ANY (v_tables)
      AND NOT (con.conrelid::regclass::text = ANY (v_tables))
    ORDER BY con.conrelid, con.confrelid
  LOOP
    EXECUTE format(
      'SELECT COALESCE(jsonb_agg(to_jsonb(c)), ''[]''::jsonb)
         FROM public.%I c
        WHERE c.%I IN (SELECT p.%I FROM public.%I p WHERE p.universe_id = $1)',
      v_child.child_table, v_child.fk_col, v_child.parent_col, v_child.parent_table
    ) INTO v_rows USING p_universe_id;
    v_payload := v_payload || jsonb_build_object(v_child.child_table, v_rows);
  END LOOP;

  -- INSERT strict (pas de ON CONFLICT) : si une archive orpheline
  -- existait, on préfère échouer et tout annuler plutôt que l'écraser.
  INSERT INTO public.universe_archives (universe_id, payload)
  VALUES (p_universe_id, v_payload);

  -- Purge des tables vives ; les cascades FK vident le niveau 2.
  FOREACH v_tbl IN ARRAY v_tables LOOP
    EXECUTE format('DELETE FROM public.%I WHERE universe_id = $1', v_tbl)
    USING p_universe_id;
  END LOOP;

  UPDATE public.universes
  SET paused_at = NOW()
  WHERE id = p_universe_id;
END;
$$;


-- ── 6. Restauration (interne) ───────────────────────────────────

CREATE OR REPLACE FUNCTION public._resume_universe_internal(p_universe_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_payload   JSONB;
  v_remaining TEXT[];
  v_tbl       TEXT;
  v_progress  BOOLEAN;
  v_has_dep   BOOLEAN;
BEGIN
  SELECT payload INTO v_payload
  FROM public.universe_archives
  WHERE universe_id = p_universe_id;

  IF v_payload IS NULL THEN
    -- Pas d'archive (ne devrait pas arriver) : simple réactivation.
    UPDATE public.universes
    SET paused_at = NULL, last_visited_at = NOW()
    WHERE id = p_universe_id;
    RETURN;
  END IF;

  -- Tables encore existantes parmi celles archivées.
  SELECT COALESCE(array_agg(k), '{}') INTO v_remaining
  FROM jsonb_object_keys(v_payload) k
  WHERE to_regclass(format('public.%I', k)) IS NOT NULL;

  -- Insertion en ordre topologique : une table n'est réinsérée que
  -- lorsque toutes celles qu'elle référence (parmi les restantes)
  -- l'ont déjà été (ex : chronicles avant chronicle_entries).
  WHILE array_length(v_remaining, 1) IS NOT NULL LOOP
    v_progress := FALSE;

    FOREACH v_tbl IN ARRAY v_remaining LOOP
      SELECT EXISTS (
        SELECT 1
        FROM pg_constraint con
        WHERE con.contype = 'f'
          AND con.conrelid = to_regclass(format('public.%I', v_tbl))
          AND con.confrelid <> con.conrelid
          AND con.confrelid::regclass::text = ANY (v_remaining)
      ) INTO v_has_dep;

      IF NOT v_has_dep THEN
        EXECUTE format(
          'INSERT INTO public.%I SELECT * FROM jsonb_populate_recordset(NULL::public.%I, $1)',
          v_tbl, v_tbl
        ) USING v_payload -> v_tbl;
        v_remaining := array_remove(v_remaining, v_tbl);
        v_progress  := TRUE;
      END IF;
    END LOOP;

    IF NOT v_progress THEN
      RAISE EXCEPTION 'Dépendances circulaires entre tables lors de la restauration de l''univers %', p_universe_id;
    END IF;
  END LOOP;

  DELETE FROM public.universe_archives WHERE universe_id = p_universe_id;

  UPDATE public.universes
  SET paused_at = NULL, last_visited_at = NOW()
  WHERE id = p_universe_id;
END;
$$;


-- ── 7. Fonctions exposées aux clients ───────────────────────────

-- Mise en pause manuelle (propriétaire uniquement). Sert aussi à
-- tester le flux sans attendre 2 mois d'inactivité.
CREATE OR REPLACE FUNCTION public.pause_universe(p_universe_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_owner UUID;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;

  SELECT owner_id INTO v_owner
  FROM public.universes
  WHERE id = p_universe_id;

  IF v_owner IS NULL THEN
    RAISE EXCEPTION 'Univers introuvable';
  END IF;

  IF v_owner != auth.uid() THEN
    RAISE EXCEPTION 'Seul le propriétaire peut mettre cet univers en pause';
  END IF;

  PERFORM public._pause_universe_internal(p_universe_id);
END;
$$;

-- Mise en pause automatique : appelée au chargement de la liste des
-- univers, elle archive les univers possédés par l'appelant que
-- personne (propriétaire ou membre) n'a visités depuis 2 mois.
-- Renvoie les ids mis en pause à l'instant.
CREATE OR REPLACE FUNCTION public.pause_stale_universes()
RETURNS SETOF UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_id UUID;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;

  FOR v_id IN
    SELECT id
    FROM public.universes
    WHERE owner_id = auth.uid()
      AND paused_at IS NULL
      AND last_visited_at < NOW() - INTERVAL '2 months'
  LOOP
    PERFORM public._pause_universe_internal(v_id);
    RETURN NEXT v_id;
  END LOOP;
END;
$$;

-- Réactivation : ouverte à tout membre de l'univers, pour qu'un
-- joueur ne soit pas bloqué si le propriétaire est absent.
CREATE OR REPLACE FUNCTION public.resume_universe(p_universe_id UUID)
RETURNS public.universes
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_universe public.universes;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;

  IF NOT public.is_universe_member(p_universe_id, auth.uid()) THEN
    RAISE EXCEPTION 'Seuls les membres de l''univers peuvent le réactiver';
  END IF;

  SELECT * INTO v_universe
  FROM public.universes
  WHERE id = p_universe_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Univers introuvable';
  END IF;

  IF v_universe.paused_at IS NOT NULL THEN
    PERFORM public._resume_universe_internal(p_universe_id);
    SELECT * INTO v_universe
    FROM public.universes
    WHERE id = p_universe_id;
  END IF;

  RETURN v_universe;
END;
$$;


-- ── 8. Droits ───────────────────────────────────────────────────

GRANT EXECUTE ON FUNCTION public.touch_universe_visit(UUID)   TO authenticated;
GRANT EXECUTE ON FUNCTION public.pause_universe(UUID)         TO authenticated;
GRANT EXECUTE ON FUNCTION public.pause_stale_universes()      TO authenticated;
GRANT EXECUTE ON FUNCTION public.resume_universe(UUID)        TO authenticated;

-- Les fonctions internes ne doivent jamais être appelées directement
-- (aucun contrôle d'autorisation à l'intérieur).
REVOKE ALL ON FUNCTION public._pause_universe_internal(UUID)  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public._resume_universe_internal(UUID) FROM PUBLIC, anon, authenticated;


-- ── 9. Les images des univers archivés ne sont pas orphelines ───
-- Le nettoyage manuel des fichiers orphelins (cf. 28) ne voit plus
-- les lignes archivées : sans ce garde-fou, il proposerait de
-- supprimer les illustrations des univers en pause.

CREATE OR REPLACE FUNCTION public.is_orphan_illustration(p_bucket_id TEXT, p_name TEXT)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT CASE p_bucket_id
    WHEN 'character-illustrations' THEN
      NOT EXISTS (SELECT 1 FROM public.characters  c WHERE (c.data->>'illustration_url') LIKE '%' || p_name || '%')
      AND NOT EXISTS (SELECT 1 FROM public.chronicles c WHERE c.illustration_url LIKE '%' || p_name || '%')
      AND NOT EXISTS (SELECT 1 FROM public.documents  d WHERE d.illustration_url LIKE '%' || p_name || '%')
      AND NOT EXISTS (SELECT 1 FROM public.universes  u WHERE u.illustration_url LIKE '%' || p_name || '%')
      AND NOT EXISTS (SELECT 1 FROM public.universe_archives a WHERE a.payload::text LIKE '%' || p_name || '%')
    WHEN 'map-images' THEN
      NOT EXISTS (SELECT 1 FROM public.maps m WHERE m.image_url LIKE '%' || p_name || '%')
      AND NOT EXISTS (SELECT 1 FROM public.universe_archives a WHERE a.payload::text LIKE '%' || p_name || '%')
    ELSE FALSE
  END;
$$;

GRANT EXECUTE ON FUNCTION public.is_orphan_illustration(TEXT, TEXT) TO authenticated;

COMMIT;
