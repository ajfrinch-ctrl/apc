-- Active Plus Coaching — Full-App + Encrypted Class Chat Supabase Realtime Sync (v1)
-- Project: Active Plus Coaching (cgtdnwktzcroxeioeyfq, ap-southeast-1, PostgreSQL 17)

CREATE SEQUENCE IF NOT EXISTS public.apc_sync_rev_seq AS bigint START WITH 1 INCREMENT BY 1;

CREATE TABLE IF NOT EXISTS public.apc_sync_nodes (
  path text PRIMARY KEY,
  val jsonb NOT NULL,
  rev bigint NOT NULL DEFAULT nextval('public.apc_sync_rev_seq'),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT apc_sync_nodes_path_valid CHECK (
    char_length(path) BETWEEN 3 AND 512
    AND path !~ '(^|/)\.\.?(/|$)'
    AND (
      path = 'activePlusSync/v1'
      OR path LIKE 'activePlusSync/v1/%'
      OR path = 'dailyAdvice'
      OR path LIKE 'dailyAdvice/%'
    )
  ),
  CONSTRAINT apc_sync_nodes_val_size CHECK (octet_length(val::text) <= 524288)
);

CREATE INDEX IF NOT EXISTS apc_sync_nodes_path_prefix_idx
  ON public.apc_sync_nodes (path text_pattern_ops);

CREATE INDEX IF NOT EXISTS apc_sync_nodes_updated_at_idx
  ON public.apc_sync_nodes (updated_at DESC);

ALTER TABLE public.apc_sync_nodes REPLICA IDENTITY FULL;

ALTER TABLE public.apc_sync_nodes ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS apc_sync_nodes_select_policy ON public.apc_sync_nodes;
CREATE POLICY apc_sync_nodes_select_policy
  ON public.apc_sync_nodes
  FOR SELECT
  TO anon, authenticated
  USING (
    path = 'activePlusSync/v1'
    OR path LIKE 'activePlusSync/v1/%'
    OR path = 'dailyAdvice'
    OR path LIKE 'dailyAdvice/%'
  );

DROP POLICY IF EXISTS apc_sync_nodes_insert_policy ON public.apc_sync_nodes;
CREATE POLICY apc_sync_nodes_insert_policy
  ON public.apc_sync_nodes
  FOR INSERT
  TO anon, authenticated
  WITH CHECK (
    char_length(path) BETWEEN 3 AND 512
    AND path !~ '(^|/)\.\.?(/|$)'
    AND octet_length(val::text) <= 524288
    AND (
      path = 'activePlusSync/v1'
      OR path LIKE 'activePlusSync/v1/%'
      OR path = 'dailyAdvice'
      OR path LIKE 'dailyAdvice/%'
    )
  );

DROP POLICY IF EXISTS apc_sync_nodes_update_policy ON public.apc_sync_nodes;
CREATE POLICY apc_sync_nodes_update_policy
  ON public.apc_sync_nodes
  FOR UPDATE
  TO anon, authenticated
  USING (
    path = 'activePlusSync/v1'
    OR path LIKE 'activePlusSync/v1/%'
    OR path = 'dailyAdvice'
    OR path LIKE 'dailyAdvice/%'
  )
  WITH CHECK (
    char_length(path) BETWEEN 3 AND 512
    AND path !~ '(^|/)\.\.?(/|$)'
    AND octet_length(val::text) <= 524288
    AND (
      path = 'activePlusSync/v1'
      OR path LIKE 'activePlusSync/v1/%'
      OR path = 'dailyAdvice'
      OR path LIKE 'dailyAdvice/%'
    )
  );

DROP POLICY IF EXISTS apc_sync_nodes_delete_policy ON public.apc_sync_nodes;
CREATE POLICY apc_sync_nodes_delete_policy
  ON public.apc_sync_nodes
  FOR DELETE
  TO anon, authenticated
  USING (
    path = 'activePlusSync/v1'
    OR path LIKE 'activePlusSync/v1/%'
    OR path = 'dailyAdvice'
    OR path LIKE 'dailyAdvice/%'
  );

GRANT SELECT, INSERT, UPDATE, DELETE ON public.apc_sync_nodes TO anon, authenticated;
GRANT USAGE, SELECT ON SEQUENCE public.apc_sync_rev_seq TO anon, authenticated;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND schemaname = 'public'
      AND tablename = 'apc_sync_nodes'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.apc_sync_nodes;
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.apc_normalize_path(p_path text)
RETURNS text
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
  cleaned text;
BEGIN
  cleaned := regexp_replace(trim(both '/' from coalesce(p_path, '')), '/+', '/', 'g');
  IF cleaned = '' OR cleaned ~ '(^|/)\.\.?(/|$)' THEN
    RAISE EXCEPTION 'Invalid sync path: %', p_path USING ERRCODE = '22023';
  END IF;
  IF NOT (
    cleaned = 'activePlusSync/v1'
    OR cleaned LIKE 'activePlusSync/v1/%'
    OR cleaned = 'dailyAdvice'
    OR cleaned LIKE 'dailyAdvice/%'
  ) THEN
    RAISE EXCEPTION 'Sync path outside allowed namespace: %', cleaned USING ERRCODE = '42501';
  END IF;
  RETURN cleaned;
END;
$$;

CREATE OR REPLACE FUNCTION public.apc_target_depth(p_path text)
RETURNS int
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
  segs text[] := string_to_array(p_path, '/');
  len int := coalesce(array_length(segs, 1), 0);
  s1 text := coalesce(segs[1], '');
  s2 text := coalesce(segs[2], '');
  s3 text := coalesce(segs[3], '');
  s4 text := coalesce(segs[4], '');
BEGIN
  IF s1 = 'dailyAdvice' THEN
    IF s2 = 'items' THEN RETURN 3; END IF;
    RETURN 2;
  END IF;

  IF s1 = 'activePlusSync' AND s2 = 'v1' THEN
    IF s3 IN ('staffDirectory', 'studentAccount', 'settings') THEN
      RETURN 3;
    END IF;
    IF s3 = 'examDb' THEN
      RETURN 5;
    END IF;
    IF s3 = 'system' THEN
      IF s4 = 'connectivityProbe' THEN RETURN 5; END IF;
      RETURN 4;
    END IF;
    IF s3 = 'db' THEN
      RETURN 5;
    END IF;
    RETURN 4;
  END IF;

  RETURN greatest(len, 3);
END;
$$;

CREATE OR REPLACE FUNCTION public.apc_resolve_sv(p_val jsonb, p_now_ms bigint)
RETURNS jsonb
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
  rec record;
  acc jsonb := '{}'::jsonb;
  elem jsonb;
  arr jsonb := '[]'::jsonb;
BEGIN
  IF p_val IS NULL THEN
    RETURN NULL;
  END IF;
  IF strpos(p_val::text, '".sv"') = 0 THEN
    RETURN p_val;
  END IF;

  IF jsonb_typeof(p_val) = 'object' THEN
    IF (p_val ? '.sv') AND (p_val ->> '.sv') = 'timestamp'
       AND (SELECT count(*) FROM jsonb_object_keys(p_val)) = 1 THEN
      RETURN to_jsonb(p_now_ms);
    END IF;
    FOR rec IN SELECT key, value FROM jsonb_each(p_val) LOOP
      acc := acc || jsonb_build_object(rec.key, public.apc_resolve_sv(rec.value, p_now_ms));
    END LOOP;
    RETURN acc;
  ELSIF jsonb_typeof(p_val) = 'array' THEN
    FOR elem IN SELECT value FROM jsonb_array_elements(p_val) LOOP
      arr := arr || jsonb_build_array(public.apc_resolve_sv(elem, p_now_ms));
    END LOOP;
    RETURN arr;
  END IF;

  RETURN p_val;
END;
$$;

CREATE OR REPLACE FUNCTION public.apc_jsonb_put_deep(p_doc jsonb, p_keys text[], p_val jsonb)
RETURNS jsonb
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
  n int := coalesce(array_length(p_keys, 1), 0);
  k text;
  base jsonb;
  sub jsonb;
BEGIN
  IF n = 0 THEN
    RETURN p_val;
  END IF;
  k := p_keys[1];
  base := CASE WHEN p_doc IS NOT NULL AND jsonb_typeof(p_doc) = 'object' THEN p_doc ELSE '{}'::jsonb END;
  IF n = 1 THEN
    RETURN base || jsonb_build_object(k, p_val);
  END IF;
  sub := CASE
    WHEN (base ? k) AND jsonb_typeof(base -> k) = 'object' THEN base -> k
    ELSE '{}'::jsonb
  END;
  RETURN base || jsonb_build_object(k, public.apc_jsonb_put_deep(sub, p_keys[2:n], p_val));
END;
$$;

CREATE OR REPLACE FUNCTION public.apc_expand_leaves(p_path text, p_val jsonb)
RETURNS TABLE(leaf_path text, leaf_val jsonb)
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
  depth int := coalesce(array_length(string_to_array(p_path, '/'), 1), 0);
  target int := public.apc_target_depth(p_path);
  rec record;
BEGIN
  IF p_val IS NULL OR jsonb_typeof(p_val) = 'null' THEN
    RETURN;
  END IF;

  IF depth >= target OR jsonb_typeof(p_val) <> 'object' THEN
    leaf_path := p_path;
    leaf_val := p_val;
    RETURN NEXT;
    RETURN;
  END IF;

  FOR rec IN SELECT key, value FROM jsonb_each(p_val) LOOP
    IF rec.key IS NOT NULL AND rec.key <> '' AND jsonb_typeof(rec.value) <> 'null' THEN
      RETURN QUERY SELECT * FROM public.apc_expand_leaves(p_path || '/' || rec.key, rec.value);
    END IF;
  END LOOP;
END;
$$;

CREATE OR REPLACE FUNCTION public.apc_subtree_version(p_norm_path text)
RETURNS text
LANGUAGE plpgsql
VOLATILE
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
     OR path LIKE p_norm_path || '/%';
  RETURN v_ver;
END;
$$;

CREATE OR REPLACE FUNCTION public.apc_server_time_ms()
RETURNS bigint
LANGUAGE sql
VOLATILE
AS $$
  SELECT (floor(extract(epoch FROM clock_timestamp()) * 1000))::bigint;
$$;

CREATE OR REPLACE FUNCTION public.apc_get_subtree(p_path text)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
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
       OR path LIKE norm || '/%'
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

CREATE OR REPLACE FUNCTION public.apc_write_subtree_internal(p_norm_path text, p_value jsonb)
RETURNS void
LANGUAGE plpgsql
VOLATILE
AS $$
DECLARE
  now_ms bigint := public.apc_server_time_ms();
  resolved jsonb;
  segs text[] := string_to_array(p_norm_path, '/');
  anc text := '';
  anc_list text[] := ARRAY[]::text[];
  i int;
BEGIN
  IF p_norm_path LIKE 'activePlusSync/v1/classChat%' THEN
    DELETE FROM public.apc_sync_nodes
    WHERE path LIKE 'activePlusSync/v1/classChat/%'
      AND path <> 'activePlusSync/v1/classChat/__metadata'
      AND coalesce((val ->> 'pinned')::boolean, false) = false
      AND (
        (jsonb_typeof(val -> 'expiresAt') = 'number' AND (val ->> 'expiresAt')::numeric <= now_ms)
        OR (jsonb_typeof(val -> 'expiresAt') = 'string' AND (val ->> 'expiresAt') ~ '^\d{4}-\d{2}-\d{2}T' AND (val ->> 'expiresAt')::timestamptz <= clock_timestamp())
      );
  END IF;

  IF p_value IS NULL OR jsonb_typeof(p_value) = 'null' THEN
    DELETE FROM public.apc_sync_nodes
    WHERE path = p_norm_path
       OR path LIKE p_norm_path || '/%';
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
  WHERE (existing.path = p_norm_path OR existing.path LIKE p_norm_path || '/%')
    AND NOT EXISTS (
      SELECT 1
      FROM public.apc_expand_leaves(p_norm_path, resolved) AS incoming
      WHERE incoming.leaf_path = existing.path
    );

  INSERT INTO public.apc_sync_nodes (path, val, rev, updated_at)
  SELECT
    incoming.leaf_path,
    incoming.leaf_val,
    nextval('public.apc_sync_rev_seq'),
    clock_timestamp()
  FROM public.apc_expand_leaves(p_norm_path, resolved) AS incoming
  ON CONFLICT (path) DO UPDATE
    SET val = EXCLUDED.val,
        rev = nextval('public.apc_sync_rev_seq'),
        updated_at = clock_timestamp()
    WHERE public.apc_sync_nodes.val IS DISTINCT FROM EXCLUDED.val;
END;
$$;

CREATE OR REPLACE FUNCTION public.apc_set_subtree(p_path text, p_value jsonb DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
AS $$
DECLARE
  norm text := public.apc_normalize_path(p_path);
BEGIN
  PERFORM pg_advisory_xact_lock(hashtext('apc_sync_v1'));
  PERFORM public.apc_write_subtree_internal(norm, p_value);
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
  PERFORM public.apc_write_subtree_internal(norm, p_value);
  RETURN public.apc_get_subtree(norm)
         || jsonb_build_object('committed', true, 'conflict', false);
END;
$$;

GRANT EXECUTE ON FUNCTION public.apc_server_time_ms() TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.apc_get_subtree(text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.apc_set_subtree(text, jsonb) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.apc_cas_subtree(text, text, jsonb) TO anon, authenticated;
