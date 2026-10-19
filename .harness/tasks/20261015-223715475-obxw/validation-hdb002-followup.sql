-- Supplemental synthetic assertions. Run only in a task-owned disposable PostgreSQL container.
\set ON_ERROR_STOP on

CREATE ROLE wacrm_migration NOLOGIN;
CREATE ROLE wacrm_runtime LOGIN;
CREATE ROLE wacrm_job LOGIN;
CREATE DATABASE wacrm_followup;
\connect wacrm_followup

CREATE TABLE account_records (
  id integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  account_id uuid NOT NULL,
  payload text NOT NULL
);
INSERT INTO account_records(account_id, payload) VALUES
  ('11111111-1111-4111-8111-111111111111', 'synthetic-account-a'),
  ('22222222-2222-4222-8222-222222222222', 'synthetic-account-b');
ALTER TABLE account_records ENABLE ROW LEVEL SECURITY;
ALTER TABLE account_records FORCE ROW LEVEL SECURITY;
CREATE POLICY account_records_scope ON account_records
  USING (account_id = nullif(current_setting('app.current_account_id', true), '')::uuid)
  WITH CHECK (account_id = nullif(current_setting('app.current_account_id', true), '')::uuid);
GRANT SELECT, INSERT, UPDATE, DELETE ON account_records TO wacrm_runtime, wacrm_job;
GRANT USAGE, SELECT ON SEQUENCE account_records_id_seq TO wacrm_runtime, wacrm_job;

DO $$ BEGIN
  IF has_schema_privilege('wacrm_runtime', 'public', 'CREATE') THEN
    RAISE EXCEPTION 'runtime unexpectedly has CREATE on public';
  END IF;
  IF NOT has_table_privilege('wacrm_runtime', 'public.account_records', 'SELECT') THEN
    RAISE EXCEPTION 'runtime SELECT grant missing';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relname = 'account_records'
      AND c.relrowsecurity AND c.relforcerowsecurity
  ) THEN
    RAISE EXCEPTION 'RLS enable/force flags missing';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'account_records'
      AND policyname = 'account_records_scope'
      AND qual IS NOT NULL AND with_check IS NOT NULL
  ) THEN
    RAISE EXCEPTION 'account RLS policy or write check missing';
  END IF;
END $$;

SELECT current_setting('server_version') AS postgres_version,
       has_schema_privilege('wacrm_runtime', 'public', 'CREATE') AS runtime_public_create,
       has_table_privilege('wacrm_runtime', 'public.account_records', 'SELECT') AS runtime_select,
       (SELECT count(*) FROM pg_policies WHERE schemaname='public' AND tablename='account_records') AS policy_count;
