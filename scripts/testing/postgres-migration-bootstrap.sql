-- TEST ONLY: run against a fresh disposable PostgreSQL cluster.
-- This fixture models the database objects referenced by historical Supabase
-- migrations. It does not install or validate Supabase Auth, Storage, or Realtime.
-- Initialize with POSTGRES_USER=bootstrap_admin (not postgres). Historical
-- migrations require a separate postgres NOLOGIN NOSUPERUSER owner role.

DO $bootstrap_preflight$
DECLARE
  administrator_is_superuser boolean;
BEGIN
  IF current_database() <> 'postgres' THEN
    RAISE EXCEPTION
      'Run this fixture only in the dedicated disposable database named postgres; current database is %',
      current_database();
  END IF;

  SELECT rolsuper INTO administrator_is_superuser
    FROM pg_roles WHERE rolname = session_user;
  IF session_user = 'postgres' OR administrator_is_superuser IS DISTINCT FROM true THEN
    RAISE EXCEPTION
      'Use a disposable cluster initialized with POSTGRES_USER=bootstrap_admin and run this fixture as that bootstrap superuser';
  END IF;

  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'postgres') THEN
    RAISE EXCEPTION
      'The postgres role already exists; initialize with a different bootstrap administrator so postgres can be NOLOGIN NOSUPERUSER';
  END IF;
END
$bootstrap_preflight$;

CREATE ROLE postgres NOLOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS;
CREATE ROLE wacrm_migrator LOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS;
CREATE ROLE wacrm_runtime LOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS;
CREATE ROLE wacrm_job LOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS;
CREATE ROLE anon NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS;
CREATE ROLE authenticated NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS;
CREATE ROLE service_role NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS;

GRANT postgres TO wacrm_migrator;
GRANT CONNECT ON DATABASE postgres TO wacrm_migrator, wacrm_runtime, wacrm_job;
GRANT CREATE ON DATABASE postgres TO postgres;
ALTER DATABASE postgres OWNER TO postgres;
REVOKE CREATE ON SCHEMA public FROM PUBLIC;
GRANT USAGE, CREATE ON SCHEMA public TO postgres;

SET ROLE postgres;

CREATE SCHEMA auth AUTHORIZATION postgres;
CREATE TABLE auth.users (
  id uuid PRIMARY KEY,
  email text,
  raw_user_meta_data jsonb NOT NULL DEFAULT '{}'::jsonb
);
CREATE FUNCTION auth.uid()
RETURNS uuid
LANGUAGE sql
STABLE
AS $$
  SELECT NULLIF(current_setting('request.jwt.claim.sub', true), '')::uuid
$$;

CREATE SCHEMA storage AUTHORIZATION postgres;
CREATE TABLE storage.buckets (
  id text PRIMARY KEY,
  name text NOT NULL,
  public boolean NOT NULL DEFAULT false,
  file_size_limit bigint,
  allowed_mime_types text[]
);
CREATE TABLE storage.objects (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  bucket_id text NOT NULL REFERENCES storage.buckets(id),
  name text NOT NULL
);
ALTER TABLE storage.objects ENABLE ROW LEVEL SECURITY;
CREATE FUNCTION storage.foldername(object_name text)
RETURNS text[]
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT string_to_array(object_name, '/')
$$;

CREATE PUBLICATION supabase_realtime;

RESET ROLE;

GRANT USAGE ON SCHEMA auth TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION auth.uid() TO PUBLIC;
GRANT USAGE ON SCHEMA storage TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION storage.foldername(text) TO PUBLIC;
GRANT USAGE, CREATE ON SCHEMA auth, storage TO postgres;
