-- Checks selected effective PostgreSQL privileges for task-only runtime/job roles.
-- This is not an exhaustive ACL inventory. The bootstrap explicitly grants CONNECT;
-- PostgreSQL PUBLIC defaults can still provide database TEMP, schema USAGE, and
-- EXECUTE on ordinary functions unless separately revoked.
DO $preflight$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_roles WHERE rolname = session_user AND rolsuper
  ) THEN
    RAISE EXCEPTION 'role-boundary probe requires the disposable fixture superuser';
  END IF;
END;
$preflight$;

DO $test$
DECLARE
  role_name text;
  role_oid oid;
  role_state record;
  recompute_oid oid := to_regprocedure('public.recompute_broadcast_counts(uuid)');
BEGIN
  FOREACH role_name IN ARRAY ARRAY['wacrm_runtime', 'wacrm_job'] LOOP
    SELECT oid INTO role_oid
      FROM pg_roles
     WHERE rolname = role_name;
    SELECT rolcanlogin, rolsuper, rolcreatedb, rolcreaterole, rolinherit, rolbypassrls
      INTO role_state
      FROM pg_roles
     WHERE rolname = role_name;
    IF NOT FOUND OR NOT role_state.rolcanlogin OR role_state.rolsuper OR
       role_state.rolcreatedb OR role_state.rolcreaterole OR role_state.rolinherit OR
       role_state.rolbypassrls THEN
      RAISE EXCEPTION 'unsafe role attributes for %', role_name;
    END IF;

    IF NOT has_database_privilege(role_name, current_database(), 'CONNECT') OR
       has_database_privilege(role_name, current_database(), 'CREATE') OR
       has_schema_privilege(role_name, 'public', 'CREATE') OR
       has_schema_privilege(role_name, 'auth', 'CREATE') OR
       has_schema_privilege(role_name, 'storage', 'CREATE') THEN
      RAISE EXCEPTION 'unsafe effective database/schema privilege for %', role_name;
    END IF;

    -- Explicit grant check: PUBLIC also holds CONNECT by default, so the
    -- effective check above cannot prove the bootstrap grant itself.
    -- Applies only to the migrated database: pg_restore without --create does not
    -- carry the database ACL, so the restore_check copy is not expected to have it.
    IF current_database() = 'postgres' AND NOT EXISTS (
      SELECT 1
        FROM pg_database AS d
        CROSS JOIN LATERAL aclexplode(d.datacl) AS a
       WHERE d.datname = current_database()
         AND a.grantee = role_oid
         AND a.privilege_type = 'CONNECT'
    ) THEN
      RAISE EXCEPTION 'explicit bootstrap CONNECT grant missing for %', role_name;
    END IF;

    IF EXISTS (SELECT 1 FROM pg_auth_members WHERE member = role_oid) OR
       pg_has_role(role_name, 'postgres', 'MEMBER') OR
       pg_has_role(role_name, 'authenticated', 'MEMBER') OR
       pg_has_role(role_name, 'service_role', 'MEMBER') THEN
      RAISE EXCEPTION 'unexpected role membership for %', role_name;
    END IF;

    IF EXISTS (
      SELECT 1
        FROM pg_class AS c
        JOIN pg_namespace AS n ON n.oid = c.relnamespace
       WHERE n.nspname IN ('public', 'auth', 'storage')
         AND c.relkind IN ('r', 'p', 'v', 'm', 'f')
         AND (
           has_table_privilege(role_name, c.oid, 'SELECT') OR
           has_table_privilege(role_name, c.oid, 'INSERT') OR
           has_table_privilege(role_name, c.oid, 'UPDATE') OR
           has_table_privilege(role_name, c.oid, 'DELETE') OR
           has_table_privilege(role_name, c.oid, 'TRUNCATE') OR
           has_table_privilege(role_name, c.oid, 'REFERENCES') OR
           has_table_privilege(role_name, c.oid, 'TRIGGER')
         )
    ) THEN
      RAISE EXCEPTION 'unexpected effective table privilege for %', role_name;
    END IF;

    IF EXISTS (
      SELECT 1
        FROM pg_class AS c
        JOIN pg_namespace AS n ON n.oid = c.relnamespace
        JOIN pg_attribute AS a ON a.attrelid = c.oid
       WHERE n.nspname IN ('public', 'auth', 'storage')
         AND c.relkind IN ('r', 'p', 'v', 'm', 'f')
         AND a.attnum > 0
         AND NOT a.attisdropped
         AND (
           has_column_privilege(role_name, c.oid, a.attname, 'SELECT') OR
           has_column_privilege(role_name, c.oid, a.attname, 'INSERT') OR
           has_column_privilege(role_name, c.oid, a.attname, 'UPDATE') OR
           has_column_privilege(role_name, c.oid, a.attname, 'REFERENCES')
         )
    ) THEN
      RAISE EXCEPTION 'unexpected effective column privilege for %', role_name;
    END IF;

    IF EXISTS (
      SELECT 1
        FROM pg_class AS c
        JOIN pg_namespace AS n ON n.oid = c.relnamespace
       WHERE n.nspname IN ('public', 'auth', 'storage')
         AND c.relkind = 'S'
         AND (
           has_sequence_privilege(role_name, c.oid, 'USAGE') OR
           has_sequence_privilege(role_name, c.oid, 'SELECT') OR
           has_sequence_privilege(role_name, c.oid, 'UPDATE')
         )
    ) THEN
      RAISE EXCEPTION 'unexpected effective sequence privilege for %', role_name;
    END IF;

    IF recompute_oid IS NULL OR has_function_privilege(role_name, recompute_oid, 'EXECUTE') THEN
      RAISE EXCEPTION 'unsafe recompute_broadcast_counts EXECUTE privilege for %', role_name;
    END IF;

    IF EXISTS (
      SELECT 1
        FROM pg_proc AS p
        JOIN pg_namespace AS n ON n.oid = p.pronamespace
       WHERE n.nspname = 'public'
         AND p.prosecdef
         AND has_function_privilege(role_name, p.oid, 'EXECUTE')
    ) THEN
      RAISE EXCEPTION 'unexpected callable SECURITY DEFINER function for %', role_name;
    END IF;
  END LOOP;
  RAISE NOTICE 'runtime/job SUCCESS on database %: selected effective ACL checks passed; explicit bootstrap CONNECT datacl check %; PUBLIC defaults are reported separately',
    current_database(),
    CASE WHEN current_database() = 'postgres' THEN 'applied' ELSE 'skipped (not the migrated database)' END;
END;
$test$;

-- Report defaults rather than implying that selected DML/DDL denials remove them.
SELECT role_name,
       has_database_privilege(role_name, current_database(), 'TEMP') AS database_temp,
       has_schema_privilege(role_name, 'public', 'USAGE') AS public_schema_usage,
       has_schema_privilege(role_name, 'auth', 'USAGE') AS auth_schema_usage,
       has_schema_privilege(role_name, 'storage', 'USAGE') AS storage_schema_usage,
       (SELECT count(*)
          FROM pg_proc AS p
          JOIN pg_namespace AS n ON n.oid = p.pronamespace
         WHERE n.nspname = 'public'
           AND NOT p.prosecdef
           AND has_function_privilege(role_name, p.oid, 'EXECUTE')) AS callable_invoker_functions
  FROM unnest(ARRAY['wacrm_runtime', 'wacrm_job']::text[]) AS roles(role_name);

-- Assert function ACLs effectively, including any explicit role grants that
-- would survive a REVOKE from PUBLIC alone.
DO $function_acl$
DECLARE
  helper_oid oid := to_regprocedure('public.is_account_member(uuid, public.account_role_enum)');
  function_signature text;
  function_oid oid;
  role_name text;
BEGIN
  IF helper_oid IS NULL THEN
    RAISE EXCEPTION 'is_account_member function is missing';
  END IF;
  IF has_function_privilege('anon', helper_oid, 'EXECUTE') THEN
    RAISE EXCEPTION 'anon must not execute is_account_member';
  END IF;
  IF NOT has_function_privilege('authenticated', helper_oid, 'EXECUTE') OR
     NOT has_function_privilege('service_role', helper_oid, 'EXECUTE') THEN
    RAISE EXCEPTION 'authenticated and service_role must execute is_account_member';
  END IF;
  IF has_function_privilege('wacrm_runtime', helper_oid, 'EXECUTE') OR
     has_function_privilege('wacrm_job', helper_oid, 'EXECUTE') THEN
    RAISE EXCEPTION 'runtime/job must not execute is_account_member before an approved grant';
  END IF;

  FOREACH function_signature IN ARRAY ARRAY[
    'public._bcast_bump(uuid,text,integer)',
    'public.broadcast_recipient_aggregate_trigger()',
    'public.handle_new_user()',
    'public.recompute_broadcast_counts(uuid)'
  ] LOOP
    function_oid := to_regprocedure(function_signature);
    IF function_oid IS NULL THEN
      RAISE EXCEPTION 'expected protected function is missing: %', function_signature;
    END IF;
    -- Triggers fire without the invoker's EXECUTE; that rests on SECURITY DEFINER
    -- ownership by the migration owner, checked here, not on invoker privileges.
    -- Owner check applies to the migrated database only: pg_restore --no-owner
    -- reassigns owners in restore_check. SECURITY DEFINER is still checked everywhere.
    IF NOT EXISTS (
      SELECT 1
        FROM pg_proc AS p
       WHERE p.oid = function_oid
         AND p.prosecdef
    ) THEN
      RAISE EXCEPTION 'protected function must be SECURITY DEFINER: %', function_signature;
    END IF;
    IF current_database() = 'postgres' AND NOT EXISTS (
      SELECT 1
        FROM pg_proc AS p
       WHERE p.oid = function_oid
         AND pg_get_userbyid(p.proowner) = 'postgres'
    ) THEN
      RAISE EXCEPTION 'protected function must be owned by postgres: %', function_signature;
    END IF;
    IF current_database() <> 'postgres' THEN
      RAISE NOTICE 'owner check skipped on database % for %', current_database(), function_signature;
    END IF;
    FOREACH role_name IN ARRAY ARRAY[
      'anon', 'authenticated', 'service_role', 'wacrm_runtime', 'wacrm_job'
    ] LOOP
      IF has_function_privilege(role_name, function_oid, 'EXECUTE') THEN
        RAISE EXCEPTION 'role % must not directly execute %', role_name, function_signature;
      END IF;
    END LOOP;
  END LOOP;
  RAISE NOTICE 'function ACL matrix SUCCESS: helper grants and direct trigger/recompute denials match policy';
END;
$function_acl$;

-- Migration 017 policies apply to PUBLIC and call is_account_member. Simulate
-- a future table grant without persisting it; anon must fail at the helper.
BEGIN;
GRANT SELECT ON TABLE public.contacts TO anon;
SET LOCAL ROLE anon;
DO $anon_policy_probe$
BEGIN
  BEGIN
    PERFORM 1 FROM public.contacts LIMIT 1;
    RAISE EXCEPTION 'expected anon access to fail at is_account_member';
  EXCEPTION
    WHEN insufficient_privilege THEN
      IF SQLERRM NOT LIKE '%is_account_member%' THEN
        RAISE EXCEPTION 'anon query failed at an unexpected privilege boundary: %', SQLERRM;
      END IF;
      RAISE NOTICE 'anon query denied at is_account_member as expected';
  END;
END;
$anon_policy_probe$;
ROLLBACK;

-- Exercise the installed auth and broadcast trigger paths after direct EXECUTE
-- is revoked. _bcast_bump runs through the broadcast trigger. All rows roll back.
-- Limitation: this block runs as the fixture superuser, which ignores function
-- ACLs. It proves trigger behavior, not invoker-without-EXECUTE behavior; that
-- part rests on the SECURITY DEFINER/owner check in the function ACL matrix and
-- on PostgreSQL CREATE TRIGGER semantics (EXECUTE is checked at trigger creation).
BEGIN;
DO $trigger_probe$
DECLARE
  v_user_id uuid := '00000000-0000-4000-8000-000000000001';
  v_account_id uuid;
  v_contact_id uuid := '00000000-0000-4000-8000-000000000002';
  v_broadcast_id uuid := '00000000-0000-4000-8000-000000000003';
  v_recipient_id uuid;
  v_aggregate record;
BEGIN
  INSERT INTO auth.users (id, email, raw_user_meta_data)
  VALUES (v_user_id, 'trigger-probe@example.invalid', '{"full_name":"Synthetic trigger probe"}');
  IF NOT EXISTS (SELECT 1 FROM public.profiles WHERE profiles.user_id = v_user_id) THEN
    RAISE EXCEPTION 'auth user trigger did not create the profile';
  END IF;
  SELECT account_id INTO v_account_id
    FROM public.profiles WHERE profiles.user_id = v_user_id;
  IF v_account_id IS NULL THEN
    RAISE EXCEPTION 'auth user trigger did not link the profile to an account';
  END IF;

  INSERT INTO public.contacts (id, account_id, user_id, phone, name)
  VALUES (v_contact_id, v_account_id, v_user_id, '+15555550100', 'Synthetic trigger probe');
  INSERT INTO public.broadcasts (id, account_id, user_id, name, template_name)
  VALUES (v_broadcast_id, v_account_id, v_user_id, 'Synthetic trigger probe', 'synthetic_template');
  INSERT INTO public.broadcast_recipients (broadcast_id, contact_id, status)
  VALUES (v_broadcast_id, v_contact_id, 'sent')
  RETURNING id INTO v_recipient_id;
  SELECT sent_count, delivered_count, read_count INTO v_aggregate
    FROM public.broadcasts WHERE id = v_broadcast_id;
  IF v_aggregate.sent_count <> 1 OR v_aggregate.delivered_count <> 0 OR v_aggregate.read_count <> 0 THEN
    RAISE EXCEPTION 'broadcast insert trigger counts incorrect: %', row_to_json(v_aggregate);
  END IF;

  UPDATE public.broadcast_recipients SET status = 'read' WHERE id = v_recipient_id;
  SELECT sent_count, delivered_count, read_count INTO v_aggregate
    FROM public.broadcasts WHERE id = v_broadcast_id;
  IF v_aggregate.sent_count <> 1 OR v_aggregate.delivered_count <> 1 OR v_aggregate.read_count <> 1 THEN
    RAISE EXCEPTION 'broadcast update trigger counts incorrect: %', row_to_json(v_aggregate);
  END IF;

  DELETE FROM public.broadcast_recipients WHERE id = v_recipient_id;
  SELECT sent_count, delivered_count, read_count INTO v_aggregate
    FROM public.broadcasts WHERE id = v_broadcast_id;
  IF v_aggregate.sent_count <> 0 OR v_aggregate.delivered_count <> 0 OR v_aggregate.read_count <> 0 THEN
    RAISE EXCEPTION 'broadcast delete trigger counts incorrect: %', row_to_json(v_aggregate);
  END IF;
  RAISE NOTICE 'auth and broadcast trigger execution SUCCESS after direct EXECUTE revocations';
END;
$trigger_probe$;
ROLLBACK;
