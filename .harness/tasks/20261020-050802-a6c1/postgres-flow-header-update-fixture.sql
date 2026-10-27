CREATE ROLE wacrm_flow_header_runtime
  LOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS;

CREATE SCHEMA auth;
CREATE TABLE auth.users (id uuid PRIMARY KEY);
CREATE FUNCTION auth.uid()
RETURNS uuid
LANGUAGE sql
STABLE
AS $$
  SELECT NULLIF(current_setting('request.jwt.claim.sub', true), '')::uuid
$$;

CREATE TYPE public.account_role_enum AS ENUM ('owner', 'admin', 'agent', 'viewer');

CREATE TABLE public.accounts (
  id uuid PRIMARY KEY,
  name text NOT NULL,
  owner_user_id uuid NOT NULL REFERENCES auth.users(id)
);

CREATE TABLE public.profiles (
  user_id uuid PRIMARY KEY REFERENCES auth.users(id),
  account_id uuid NOT NULL REFERENCES public.accounts(id),
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

CREATE TABLE public.flows (
  id uuid PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES auth.users(id),
  account_id uuid NOT NULL REFERENCES public.accounts(id) ON DELETE CASCADE,
  name text NOT NULL,
  description text,
  status text NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft', 'active', 'archived')),
  trigger_type text NOT NULL
    CHECK (trigger_type IN ('keyword', 'first_inbound_message', 'manual')),
  trigger_config jsonb NOT NULL DEFAULT '{}'::jsonb,
  entry_node_id text,
  fallback_policy jsonb NOT NULL DEFAULT '{}'::jsonb,
  updated_at timestamptz NOT NULL DEFAULT NOW()
);

ALTER TABLE public.accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.accounts FORCE ROW LEVEL SECURITY;
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.profiles FORCE ROW LEVEL SECURITY;
ALTER TABLE public.flows ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.flows FORCE ROW LEVEL SECURITY;

CREATE POLICY accounts_select_members
  ON public.accounts FOR SELECT TO wacrm_flow_header_runtime
  USING (public.is_account_member(id));
CREATE POLICY profiles_select_members
  ON public.profiles FOR SELECT TO wacrm_flow_header_runtime
  USING (auth.uid() = user_id OR public.is_account_member(account_id));
CREATE POLICY flows_select_members
  ON public.flows FOR SELECT TO wacrm_flow_header_runtime
  USING (public.is_account_member(account_id));
CREATE POLICY flows_update_agents
  ON public.flows FOR UPDATE TO wacrm_flow_header_runtime
  USING (public.is_account_member(account_id, 'agent'))
  WITH CHECK (public.is_account_member(account_id, 'agent'));

GRANT CONNECT ON DATABASE postgres TO wacrm_flow_header_runtime;
GRANT USAGE ON SCHEMA auth, public TO wacrm_flow_header_runtime;
GRANT USAGE ON TYPE public.account_role_enum TO wacrm_flow_header_runtime;
GRANT EXECUTE ON FUNCTION auth.uid() TO wacrm_flow_header_runtime;
GRANT EXECUTE ON FUNCTION public.is_account_member(uuid, public.account_role_enum)
  TO wacrm_flow_header_runtime;
GRANT SELECT (id, name) ON TABLE public.accounts TO wacrm_flow_header_runtime;
GRANT SELECT (user_id, account_id, account_role) ON TABLE public.profiles
  TO wacrm_flow_header_runtime;
GRANT SELECT (id, user_id, account_id) ON TABLE public.flows
  TO wacrm_flow_header_runtime;
GRANT UPDATE (name, description, trigger_type, trigger_config, entry_node_id,
  fallback_policy, updated_at) ON TABLE public.flows TO wacrm_flow_header_runtime;

INSERT INTO auth.users (id) VALUES
  ('00000000-0000-4000-8000-000000000001'),
  ('00000000-0000-4000-8000-000000000002'),
  ('00000000-0000-4000-8000-000000000003'),
  ('00000000-0000-4000-8000-000000000004');
INSERT INTO public.accounts (id, name, owner_user_id) VALUES
  ('10000000-0000-4000-8000-000000000001', 'Synthetic Account A', '00000000-0000-4000-8000-000000000001'),
  ('10000000-0000-4000-8000-000000000002', 'Synthetic Account B', '00000000-0000-4000-8000-000000000004');
INSERT INTO public.profiles (user_id, account_id, account_role) VALUES
  ('00000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000001', 'owner'),
  ('00000000-0000-4000-8000-000000000002', '10000000-0000-4000-8000-000000000001', 'agent'),
  ('00000000-0000-4000-8000-000000000003', '10000000-0000-4000-8000-000000000001', 'viewer'),
  ('00000000-0000-4000-8000-000000000004', '10000000-0000-4000-8000-000000000002', 'agent');
INSERT INTO public.flows (
  id, user_id, account_id, name, description, trigger_type, updated_at
) VALUES
  ('70000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000001', 'Synthetic flow A', 'Before A', 'keyword', '2000-01-01T00:00:00Z'),
  ('70000000-0000-4000-8000-000000000002', '00000000-0000-4000-8000-000000000004', '10000000-0000-4000-8000-000000000002', 'Synthetic flow B', 'Before B', 'keyword', '2000-01-01T00:00:00Z');
