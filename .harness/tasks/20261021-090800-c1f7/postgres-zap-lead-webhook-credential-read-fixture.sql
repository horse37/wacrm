-- Synthetic fixture for the disposable PostgreSQL 16 validation only.
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

SET ROLE postgres;
CREATE TABLE public.zap_lead_integrations (
  account_id UUID PRIMARY KEY,
  api_base_url TEXT NOT NULL,
  key_id TEXT,
  encrypted_registration TEXT NOT NULL
);
CREATE UNIQUE INDEX zap_lead_integrations_key_id_uidx
  ON public.zap_lead_integrations (key_id)
  WHERE key_id IS NOT NULL;
RESET ROLE;

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

ALTER TABLE public.zap_lead_integrations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.zap_lead_integrations FORCE ROW LEVEL SECURITY;
