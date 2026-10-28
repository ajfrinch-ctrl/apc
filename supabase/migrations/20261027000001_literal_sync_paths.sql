-- Staged, non-destructive integrity hardening for the existing v1 sync API.
-- This migration DOES NOT change the interim RLS policies or grant role-based
-- authorization. Deploy only after a backup, staging verification, and owner
-- approval; the anonymous authorization risk remains until the separate
-- identity/data-layout migration is complete.
--
-- A PostgreSQL LIKE pattern interprets '_' and '%' in an ordinary record ID as
-- wildcards. Prefix checks below are literal, so one record can never read,
-- replace, delete, or participate in the CAS version of a sibling by accident.

CREATE SCHEMA IF NOT EXISTS apc_internal;
REVOKE ALL ON SCHEMA apc_internal FROM PUBLIC;
GRANT USAGE ON SCHEMA apc_internal TO anon, authenticated;

CREATE OR REPLACE FUNCTION public.apc_subtree_version(p_norm_path text)
RETURNS text
LANGUAGE plpgsql
VOLATILE
SET search_path = pg_catalog
AS $$
DECLARE
  v_ver text;
BEGIN
  SELECT
    count(*)::text
    || ':' || coalesce(max(rev), 0)::text
    || ':' || coalesce(bit_xor(hashtextextended(path || ':' || rev::text, 0)), 0)::text
  INTO v_ver
  FROM public.apc_sync_nodes
  WHERE path = p_norm_path
     OR starts_with(path, p_norm_path || '/');
  RETURN v_ver;
END;
$$;

CREATE OR REPLACE FUNCTION public.apc_get_subtree(p_path text)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SET search_path = pg_catalog
AS $$
DECLARE
  norm text := public.apc_normalize_path(p_path);
  prefix_len int := char_length(norm) + 2;
  rec record;
  doc jsonb := NULL;
  found boolean := false;
  rel text;
  ver text;
BEGIN
  FOR rec IN
    SELECT path, val
    FROM public.apc_sync_nodes
    WHERE path = norm
       OR starts_with(path, norm || '/')
    ORDER BY path ASC
  LOOP
    found := true;
    IF rec.path = norm THEN
      doc := rec.val;
    ELSE
      rel := substr(rec.path, prefix_len);
      doc := public.apc_jsonb_put_deep(doc, string_to_array(rel, '/'), rec.val);
    END IF;
  END LOOP;

  ver := public.apc_subtree_version(norm);
  RETURN jsonb_build_object(
    'exists', found,
    'value', CASE WHEN found THEN doc ELSE 'null'::jsonb END,
    'version', ver,
    'serverTimeMs', public.apc_server_time_ms()
  );
END;
$$;

-- PostgREST exposes public functions by default. Keep the write primitive in
-- a non-exposed schema, use invoker privileges (RLS still applies), and keep
-- both normalization and locking inside it as defence in depth. The schema
-- must not be added to the project's API exposed-schema list.
CREATE OR REPLACE FUNCTION apc_internal.write_subtree(p_path text, p_value jsonb)
RETURNS void
LANGUAGE plpgsql
VOLATILE
SET search_path = pg_catalog
AS $$
DECLARE
  norm text := public.apc_normalize_path(p_path);
  now_ms bigint := public.apc_server_time_ms();
  resolved jsonb;
  segs text[] := string_to_array(norm, '/');
  anc text := '';
  anc_list text[] := ARRAY[]::text[];
  i int;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtext('apc_sync_v1'));

  IF norm = 'activePlusSync/v1/classChat'
     OR starts_with(norm, 'activePlusSync/v1/classChat/') THEN
    DELETE FROM public.apc_sync_nodes
    WHERE starts_with(path, 'activePlusSync/v1/classChat/')
      AND path <> 'activePlusSync/v1/classChat/__metadata'
      -- Unexpected pinned values are treated conservatively as pinned, rather
      -- than causing all class-chat writes to fail or deleting unknown data.
      AND CASE
        WHEN NOT (val ? 'pinned') OR jsonb_typeof(val -> 'pinned') = 'null' THEN true
        WHEN jsonb_typeof(val -> 'pinned') = 'boolean' THEN NOT (val ->> 'pinned')::boolean
        ELSE false
      END
      AND CASE
        WHEN jsonb_typeof(val -> 'expiresAt') = 'number'
          THEN (val ->> 'expiresAt')::numeric <= now_ms
        WHEN jsonb_typeof(val -> 'expiresAt') = 'string'
          AND pg_input_is_valid(val ->> 'expiresAt', 'timestamp with time zone')
          THEN (val ->> 'expiresAt')::timestamptz <= clock_timestamp()
        ELSE false
      END;
  END IF;

  IF p_value IS NULL OR jsonb_typeof(p_value) = 'null' THEN
    DELETE FROM public.apc_sync_nodes
    WHERE path = norm
       OR starts_with(path, norm || '/');
    RETURN;
  END IF;

  resolved := public.apc_resolve_sv(p_value, now_ms);

  IF coalesce(array_length(segs, 1), 0) > 1 THEN
    FOR i IN 1..(array_length(segs, 1) - 1) LOOP
      anc := CASE WHEN i = 1 THEN segs[1] ELSE anc || '/' || segs[i] END;
      anc_list := array_append(anc_list, anc);
    END LOOP;
    DELETE FROM public.apc_sync_nodes WHERE path = ANY(anc_list);
  END IF;

  DELETE FROM public.apc_sync_nodes AS existing
  WHERE (existing.path = norm OR starts_with(existing.path, norm || '/'))
    AND NOT EXISTS (
      SELECT 1
      FROM public.apc_expand_leaves(norm, resolved) AS incoming
      WHERE incoming.leaf_path = existing.path
    );

  INSERT INTO public.apc_sync_nodes (path, val, rev, updated_at)
  SELECT incoming.leaf_path, incoming.leaf_val,
         nextval('public.apc_sync_rev_seq'), clock_timestamp()
  FROM public.apc_expand_leaves(norm, resolved) AS incoming
  ON CONFLICT (path) DO UPDATE
    SET val = EXCLUDED.val,
        rev = nextval('public.apc_sync_rev_seq'),
        updated_at = clock_timestamp()
    WHERE public.apc_sync_nodes.val IS DISTINCT FROM EXCLUDED.val;
END;
$$;

REVOKE ALL ON FUNCTION apc_internal.write_subtree(text, jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION apc_internal.write_subtree(text, jsonb) TO anon, authenticated;

CREATE OR REPLACE FUNCTION public.apc_set_subtree(p_path text, p_value jsonb DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SET search_path = pg_catalog
AS $$
DECLARE
  norm text := public.apc_normalize_path(p_path);
BEGIN
  PERFORM pg_advisory_xact_lock(hashtext('apc_sync_v1'));
  PERFORM apc_internal.write_subtree(norm, p_value);
  RETURN jsonb_build_object(
    'ok', true,
    'version', public.apc_subtree_version(norm),
    'serverTimeMs', public.apc_server_time_ms()
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.apc_cas_subtree(
  p_path text,
  p_expected_version text,
  p_value jsonb DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SET search_path = pg_catalog
AS $$
DECLARE
  norm text := public.apc_normalize_path(p_path);
  cur_ver text;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtext('apc_sync_v1'));
  cur_ver := public.apc_subtree_version(norm);
  IF cur_ver IS DISTINCT FROM coalesce(p_expected_version, '') THEN
    RETURN public.apc_get_subtree(norm)
           || jsonb_build_object('committed', false, 'conflict', true);
  END IF;
  PERFORM apc_internal.write_subtree(norm, p_value);
  RETURN public.apc_get_subtree(norm)
         || jsonb_build_object('committed', true, 'conflict', false);
END;
$$;

-- Keep the old helper in place for dependency compatibility, but never expose
-- it as an RPC. The public wrappers above now call the locked private helper.
REVOKE ALL ON FUNCTION public.apc_write_subtree_internal(text, jsonb) FROM PUBLIC, anon, authenticated;
