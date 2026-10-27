CREATE ROLE wacrm_whatsapp_flow_run_runtime
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
SET search_path = public, pg_temp
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

CREATE TABLE public.flow_runs (
  id uuid PRIMARY KEY,
  account_id uuid NOT NULL,
  contact_id uuid,
  status text NOT NULL CHECK (
    status IN ('active', 'completed', 'handed_off', 'timed_out', 'paused_by_agent', 'failed')
  ),
  ended_at timestamptz,
  end_reason text
);

ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.profiles FORCE ROW LEVEL SECURITY;
ALTER TABLE public.flow_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.flow_runs FORCE ROW LEVEL SECURITY;

CREATE POLICY profiles_select ON public.profiles
FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY flow_runs_select ON public.flow_runs
FOR SELECT USING (public.is_account_member(account_id));
CREATE POLICY flow_runs_update ON public.flow_runs
FOR UPDATE
USING (public.is_account_member(account_id, 'agent'))
WITH CHECK (public.is_account_member(account_id, 'agent'));

GRANT USAGE ON SCHEMA public, auth TO wacrm_whatsapp_flow_run_runtime;
GRANT EXECUTE ON FUNCTION auth.uid() TO wacrm_whatsapp_flow_run_runtime;
GRANT EXECUTE ON FUNCTION public.is_account_member(uuid, public.account_role_enum)
TO wacrm_whatsapp_flow_run_runtime;
GRANT SELECT ON public.profiles, public.flow_runs TO wacrm_whatsapp_flow_run_runtime;
GRANT UPDATE ON public.flow_runs TO wacrm_whatsapp_flow_run_runtime;

INSERT INTO public.profiles VALUES
  ('00000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000001', 'owner'),
  ('00000000-0000-4000-8000-000000000002', '10000000-0000-4000-8000-000000000001', 'viewer'),
  ('00000000-0000-4000-8000-000000000003', '10000000-0000-4000-8000-000000000002', 'owner');

INSERT INTO public.flow_runs (id, account_id, contact_id, status, ended_at, end_reason)
VALUES
  ('70000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000001', '40000000-0000-4000-8000-000000000001', 'active', NULL, NULL),
  ('70000000-0000-4000-8000-000000000002', '10000000-0000-4000-8000-000000000002', '40000000-0000-4000-8000-000000000002', 'active', NULL, NULL),
  ('70000000-0000-4000-8000-000000000003', '10000000-0000-4000-8000-000000000001', '40000000-0000-4000-8000-000000000003', 'active', NULL, NULL),
  ('70000000-0000-4000-8000-000000000004', '10000000-0000-4000-8000-000000000001', '40000000-0000-4000-8000-000000000004', 'completed', '2026-10-20T10:00:00Z', 'completed');
