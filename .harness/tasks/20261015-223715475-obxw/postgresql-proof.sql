-- Synthetic H-DB-002 probe. Run only in a task-owned disposable PostgreSQL container.
\set ON_ERROR_STOP on

CREATE ROLE wacrm_migration NOLOGIN;
CREATE ROLE wacrm_runtime LOGIN;
CREATE ROLE wacrm_job LOGIN;
CREATE DATABASE wacrm_validation;
\connect wacrm_validation

CREATE TABLE migration_history (
  version text PRIMARY KEY,
  applied_at timestamptz NOT NULL DEFAULT now()
);
INSERT INTO migration_history(version) VALUES ('proof-001') ON CONFLICT DO NOTHING;
INSERT INTO migration_history(version) VALUES ('proof-001') ON CONFLICT DO NOTHING;
DO $$ BEGIN
  IF (SELECT count(*) FROM migration_history WHERE version = 'proof-001') <> 1 THEN
    RAISE EXCEPTION 'migration replay was not idempotent';
  END IF;
END $$;

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
  IF EXISTS (
    SELECT 1 FROM pg_roles
    WHERE rolname IN ('wacrm_runtime', 'wacrm_job')
      AND (rolsuper OR rolcreatedb OR rolcreaterole OR rolbypassrls)
  ) THEN RAISE EXCEPTION 'runtime/job role has an elevated privilege'; END IF;
END $$;

BEGIN;
SET LOCAL ROLE wacrm_runtime;
DO $$ BEGIN
  IF (SELECT count(*) FROM account_records) <> 0 THEN
    RAISE EXCEPTION 'missing account context did not fail closed';
  END IF;
END $$;
SELECT set_config('app.current_account_id', '11111111-1111-4111-8111-111111111111', true);
DO $$ BEGIN
  IF (SELECT count(*) FROM account_records) <> 1 THEN
    RAISE EXCEPTION 'account context did not isolate reads';
  END IF;
  BEGIN
    INSERT INTO account_records(account_id, payload)
    VALUES ('22222222-2222-4222-8222-222222222222', 'cross-account-write');
    RAISE EXCEPTION 'cross-account write unexpectedly succeeded';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
END $$;
COMMIT;

BEGIN;
SET LOCAL ROLE wacrm_runtime;
DO $$ BEGIN
  IF (SELECT count(*) FROM account_records) <> 0 THEN
    RAISE EXCEPTION 'transaction-local account context leaked after commit';
  END IF;
END $$;
COMMIT;

BEGIN;
SET LOCAL ROLE wacrm_runtime;
SELECT set_config('app.current_account_id', '11111111-1111-4111-8111-111111111111', true);
DO $$ DECLARE denied boolean := false; BEGIN
  BEGIN EXECUTE 'CREATE TABLE forbidden_runtime_ddl(id integer)';
  EXCEPTION WHEN insufficient_privilege THEN denied := true;
  END;
  IF NOT denied THEN RAISE EXCEPTION 'runtime role unexpectedly created a table'; END IF;
END $$;
ROLLBACK;

BEGIN;
CREATE TABLE migration_failure_probe(id integer);
ROLLBACK;
DO $$ BEGIN
  IF to_regclass('public.migration_failure_probe') IS NOT NULL THEN
    RAISE EXCEPTION 'transaction rollback left partial DDL';
  END IF;
END $$;
