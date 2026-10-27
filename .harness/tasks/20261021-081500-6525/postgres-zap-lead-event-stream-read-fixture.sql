CREATE ROLE wacrm_zap_lead_event_stream_read_runtime
  LOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS;

CREATE SCHEMA auth;
CREATE FUNCTION auth.uid()
RETURNS uuid
LANGUAGE sql
STABLE
AS $$
  SELECT NULLIF(current_setting('request.jwt.claim.sub', true), '')::uuid
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
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.profiles AS p
    WHERE p.user_id = auth.uid()
      AND p.account_id = target_account_id
      AND CASE p.account_role
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
  account_id uuid PRIMARY KEY,
  api_base_url text NOT NULL,
  key_id text,
  encrypted_registration text NOT NULL
);

CREATE TABLE public.zap_lead_integration_state (
  account_id uuid PRIMARY KEY REFERENCES public.zap_lead_integrations(account_id) ON DELETE CASCADE,
  integration_key_id text,
  last_sse_cursor_id uuid
);

ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.profiles FORCE ROW LEVEL SECURITY;
CREATE POLICY profiles_select ON public.profiles
  FOR SELECT USING (auth.uid() = user_id);

ALTER TABLE public.zap_lead_integrations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.zap_lead_integrations FORCE ROW LEVEL SECURITY;
CREATE POLICY zap_lead_integrations_admin_select
  ON public.zap_lead_integrations FOR SELECT
  USING (public.is_account_member(account_id, 'admin'));

ALTER TABLE public.zap_lead_integration_state ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.zap_lead_integration_state FORCE ROW LEVEL SECURITY;
CREATE POLICY zap_lead_integration_state_admin_select
  ON public.zap_lead_integration_state FOR SELECT
  USING (public.is_account_member(account_id, 'admin'));

GRANT USAGE ON SCHEMA public, auth TO wacrm_zap_lead_event_stream_read_runtime;
GRANT EXECUTE ON FUNCTION auth.uid() TO wacrm_zap_lead_event_stream_read_runtime;
GRANT EXECUTE ON FUNCTION public.is_account_member(uuid, public.account_role_enum)
  TO wacrm_zap_lead_event_stream_read_runtime;
GRANT SELECT ON public.profiles, public.zap_lead_integrations,
  public.zap_lead_integration_state TO wacrm_zap_lead_event_stream_read_runtime;

INSERT INTO public.profiles (user_id, account_id, account_role) VALUES
  ('00000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000001', 'owner'),
  ('00000000-0000-4000-8000-000000000002', '10000000-0000-4000-8000-000000000001', 'viewer'),
  ('00000000-0000-4000-8000-000000000003', '10000000-0000-4000-8000-000000000002', 'owner');

INSERT INTO public.zap_lead_integrations
  (account_id, api_base_url, key_id, encrypted_registration)
VALUES
  ('10000000-0000-4000-8000-000000000001', 'https://zap-a.example.test', 'ak_000000000000000000000000', 'synthetic-ciphertext-account-a'),
  ('10000000-0000-4000-8000-000000000002', 'https://zap-b.example.test', 'ak_111111111111111111111111', 'synthetic-ciphertext-account-b');

INSERT INTO public.zap_lead_integration_state
  (account_id, integration_key_id, last_sse_cursor_id)
VALUES
  ('10000000-0000-4000-8000-000000000001', 'ak_000000000000000000000000', '18fae01a-a5b8-4a7e-95af-453810e49dc9'),
  ('10000000-0000-4000-8000-000000000002', 'ak_111111111111111111111111', '28fae01a-a5b8-4a7e-95af-453810e49dc9');