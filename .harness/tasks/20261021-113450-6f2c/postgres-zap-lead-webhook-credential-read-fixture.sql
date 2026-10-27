-- Historical synthetic fixture for isolated PostgreSQL 16 repository tests.
-- It does not establish current migration parity. Migration 028 installs the
-- runtime read policies and grants; that contract is exercised by
-- scripts/testing/validate-postgres-zap-lead-runtime-migration.ps1, which
-- applies the checked-in migration chain before running the same integration.
-- This fixture retains a simplified membership helper for the earlier
-- isolated RLS proof and is not evidence for migration 028.
CREATE ROLE postgres
  NOLOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS;
CREATE ROLE wacrm_runtime
  LOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS;
CREATE ROLE anon NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS;
CREATE ROLE authenticated NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS;
CREATE ROLE service_role NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS;
CREATE ROLE wacrm_job NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS;
CREATE ROLE wacrm_migrator NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS;

GRANT CONNECT ON DATABASE postgres TO wacrm_runtime;
GRANT USAGE, CREATE ON SCHEMA public TO postgres;
CREATE SCHEMA auth;
GRANT USAGE, CREATE ON SCHEMA auth TO postgres;

SET ROLE postgres;
CREATE FUNCTION auth.uid()
RETURNS uuid
LANGUAGE sql
STABLE
AS $$
  SELECT NULLIF(pg_catalog.current_setting('request.jwt.claim.sub', true), '')::uuid
$$;
CREATE TYPE public.account_role_enum AS ENUM ('owner', 'admin', 'agent', 'viewer');
CREATE TABLE public.profiles (
  user_id uuid PRIMARY KEY,
  account_id uuid NOT NULL,
  account_role public.account_role_enum NOT NULL
);
CREATE FUNCTION public.is_account_member(
  target_account_id uuid,
  min_role public.account_role_enum DEFAULT 'viewer'
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = pg_catalog, public, auth, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.profiles AS profile
    WHERE profile.user_id = auth.uid()
      AND profile.account_id = target_account_id
      AND CASE profile.account_role
        WHEN 'owner' THEN 4
        WHEN 'admin' THEN 3
        WHEN 'agent' THEN 2
        WHEN 'viewer' THEN 1
      END >= CASE min_role
        WHEN 'owner' THEN 4
        WHEN 'admin' THEN 3
        WHEN 'agent' THEN 2
        WHEN 'viewer' THEN 1
      END
  )
$$;
CREATE TABLE public.zap_lead_integrations (
  account_id UUID PRIMARY KEY,
  api_base_url TEXT NOT NULL,
  key_id TEXT,
encrypted_registration TEXT NOT NULL,
created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX zap_lead_integrations_key_id_uidx
  ON public.zap_lead_integrations (key_id)
  WHERE key_id IS NOT NULL;
CREATE TABLE public.zap_lead_integration_state (
  account_id uuid PRIMARY KEY
    REFERENCES public.zap_lead_integrations(account_id) ON DELETE CASCADE,
  integration_key_id text NOT NULL,
  last_success_at timestamptz,
  last_failure_at timestamptz,
  last_error_code text,
  alert_sent_at timestamptz,
  last_sse_cursor_id uuid
);
RESET ROLE;

INSERT INTO public.profiles (user_id, account_id, account_role)
VALUES
  ('00000000-0000-4000-8000-000000000001',
   '10000000-0000-4000-8000-000000000001', 'admin'),
  ('00000000-0000-4000-8000-000000000002',
   '10000000-0000-4000-8000-000000000001', 'viewer'),
  ('00000000-0000-4000-8000-000000000003',
   '10000000-0000-4000-8000-000000000002', 'admin');
INSERT INTO public.zap_lead_integrations
  (account_id, api_base_url, key_id, encrypted_registration)
VALUES
  (
    '10000000-0000-4000-8000-000000000001',
    'https://synthetic-a.example.test',
    'ak_aaaaaaaaaaaaaaaaaaaaaaaa',
    'synthetic-encrypted-registration-a'
  ),
  (
    '10000000-0000-4000-8000-000000000002',
    'https://synthetic-b.example.test',
    'ak_bbbbbbbbbbbbbbbbbbbbbbbb',
    'synthetic-encrypted-registration-b'
  );

INSERT INTO public.zap_lead_integration_state (
  account_id,
  integration_key_id,
  last_success_at,
  last_error_code,
  alert_sent_at,
  last_sse_cursor_id
)
VALUES
  ('10000000-0000-4000-8000-000000000001',
   'ak_aaaaaaaaaaaaaaaaaaaaaaaa', '2026-10-20T09:00:00Z',
   'synthetic-a', '2026-10-20T09:05:00Z',
   '18fae01a-a5b8-4a7e-95af-453810e49dc9'),
  ('10000000-0000-4000-8000-000000000002',
   'ak_bbbbbbbbbbbbbbbbbbbbbbbb', '2026-10-20T10:00:00Z',
   'synthetic-b', '2026-10-20T10:05:00Z',
   '28fae01a-a5b8-4a7e-95af-453810e49dc9');

SET ROLE postgres;
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.profiles FORCE ROW LEVEL SECURITY;
CREATE POLICY profiles_select ON public.profiles
  FOR SELECT TO wacrm_runtime USING (auth.uid() = user_id);
ALTER TABLE public.zap_lead_integrations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.zap_lead_integrations FORCE ROW LEVEL SECURITY;
CREATE POLICY zap_lead_integrations_admin_select
  ON public.zap_lead_integrations FOR SELECT TO wacrm_runtime
  USING (public.is_account_member(account_id, 'admin'));
DROP POLICY IF EXISTS zap_lead_webhook_credential_lookup
ON public.zap_lead_integrations;
CREATE POLICY zap_lead_webhook_credential_lookup
ON public.zap_lead_integrations
FOR SELECT TO wacrm_runtime
USING (
  key_id = NULLIF(
    pg_catalog.current_setting(
      'app.wacrm_zap_lead_webhook_key_id',
      true
    ),
    ''
  )
);
ALTER TABLE public.zap_lead_integration_state ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.zap_lead_integration_state FORCE ROW LEVEL SECURITY;
CREATE POLICY zap_lead_integration_state_admin_select
  ON public.zap_lead_integration_state FOR SELECT TO wacrm_runtime
  USING (public.is_account_member(account_id, 'admin'));
RESET ROLE;
GRANT USAGE ON SCHEMA public, auth TO wacrm_runtime;
GRANT EXECUTE ON FUNCTION auth.uid() TO wacrm_runtime;
GRANT EXECUTE ON FUNCTION public.is_account_member(
  uuid,
  public.account_role_enum
) TO wacrm_runtime;
GRANT SELECT ON TABLE public.profiles TO wacrm_runtime;
REVOKE ALL ON TABLE public.zap_lead_integrations FROM wacrm_runtime;
GRANT SELECT (api_base_url, key_id, account_id, encrypted_registration)
ON TABLE public.zap_lead_integrations TO wacrm_runtime;
REVOKE ALL ON TABLE public.zap_lead_integration_state FROM wacrm_runtime;
GRANT SELECT (
  account_id,
  integration_key_id,
  last_success_at,
  last_failure_at,
  last_error_code,
  alert_sent_at,
  last_sse_cursor_id
)
ON TABLE public.zap_lead_integration_state TO wacrm_runtime;
