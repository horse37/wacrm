CREATE ROLE wacrm_flow_list_runtime
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

CREATE TABLE public.accounts (
  id uuid PRIMARY KEY,
  name text NOT NULL,
  owner_user_id uuid NOT NULL
);

CREATE TABLE public.profiles (
  id uuid PRIMARY KEY,
  user_id uuid NOT NULL UNIQUE,
  account_id uuid NOT NULL REFERENCES public.accounts(id),
  account_role public.account_role_enum NOT NULL,
  full_name text NOT NULL
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
  user_id uuid NOT NULL,
  account_id uuid NOT NULL REFERENCES public.accounts(id),
  name text NOT NULL,
  description text,
  status text NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft', 'active', 'archived')),
  trigger_type text NOT NULL
    CHECK (trigger_type IN ('keyword', 'first_inbound_message', 'manual')),
  trigger_config jsonb NOT NULL DEFAULT '{}'::jsonb,
  entry_node_id text,
  fallback_policy jsonb NOT NULL DEFAULT '{}'::jsonb,
  execution_count integer NOT NULL DEFAULT 0,
  last_executed_at timestamptz,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL
);

ALTER TABLE public.accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.accounts FORCE ROW LEVEL SECURITY;
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.profiles FORCE ROW LEVEL SECURITY;
ALTER TABLE public.flows ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.flows FORCE ROW LEVEL SECURITY;

CREATE POLICY accounts_select_members
  ON public.accounts FOR SELECT TO wacrm_flow_list_runtime
  USING (public.is_account_member(id));
CREATE POLICY profiles_select_members
  ON public.profiles FOR SELECT TO wacrm_flow_list_runtime
  USING (auth.uid() = user_id OR public.is_account_member(account_id));
CREATE POLICY flows_select_members
  ON public.flows FOR SELECT TO wacrm_flow_list_runtime
  USING (public.is_account_member(account_id));

GRANT USAGE ON SCHEMA auth, public TO wacrm_flow_list_runtime;
GRANT EXECUTE ON FUNCTION auth.uid() TO wacrm_flow_list_runtime;
GRANT EXECUTE ON FUNCTION public.is_account_member(uuid, public.account_role_enum)
  TO wacrm_flow_list_runtime;
GRANT SELECT (id, name) ON TABLE public.accounts TO wacrm_flow_list_runtime;
GRANT SELECT (user_id, account_id, account_role)
  ON TABLE public.profiles TO wacrm_flow_list_runtime;
GRANT SELECT (id, user_id, account_id, name, description, status, trigger_type, trigger_config, execution_count, created_at)
  ON TABLE public.flows TO wacrm_flow_list_runtime;

INSERT INTO public.accounts (id, name, owner_user_id) VALUES
  ('10000000-0000-4000-8000-000000000001', 'Synthetic Account A', '00000000-0000-4000-8000-000000000001'),
  ('10000000-0000-4000-8000-000000000002', 'Synthetic Account B', '00000000-0000-4000-8000-000000000002'),
  ('10000000-0000-4000-8000-000000000003', 'Synthetic Account C', '00000000-0000-4000-8000-000000000004');

INSERT INTO public.profiles (id, user_id, account_id, account_role, full_name) VALUES
  ('20000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000001', 'owner', 'Synthetic Owner A'),
  ('20000000-0000-4000-8000-000000000003', '00000000-0000-4000-8000-000000000003', '10000000-0000-4000-8000-000000000001', 'viewer', 'Synthetic Viewer A'),
  ('20000000-0000-4000-8000-000000000005', '00000000-0000-4000-8000-000000000005', '10000000-0000-4000-8000-000000000001', 'agent', 'Synthetic Agent A'),
  ('20000000-0000-4000-8000-000000000002', '00000000-0000-4000-8000-000000000002', '10000000-0000-4000-8000-000000000002', 'owner', 'Synthetic Owner B'),
  ('20000000-0000-4000-8000-000000000004', '00000000-0000-4000-8000-000000000004', '10000000-0000-4000-8000-000000000003', 'admin', 'Synthetic Admin C'),
  ('20000000-0000-4000-8000-000000000006', '00000000-0000-4000-8000-000000000006', '10000000-0000-4000-8000-000000000003', 'owner', 'Former Member A');

INSERT INTO public.flows (
  id, user_id, account_id, name, description, status, trigger_type,
  trigger_config, entry_node_id, fallback_policy, execution_count,
  last_executed_at, created_at, updated_at
) VALUES
  ('30000000-0000-4000-8000-000000000003', '00000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000001', 'Newest A', NULL, 'active', 'keyword', '{"keywords":["synthetic","test"]}', 'private-node-key', '{"private":"synthetic fallback"}', 12, '2026-10-19 11:00:00+00', '2026-10-19 10:00:00+00', '2026-10-19 11:00:00+00'),
  ('30000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000005', '10000000-0000-4000-8000-000000000001', 'Newest A tie', 'Stable UUID order', 'draft', 'manual', '{}', NULL, '{}', 0, NULL, '2026-10-19 10:00:00+00', '2026-10-19 10:00:00+00'),
  ('30000000-0000-4000-8000-000000000002', '00000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000001', 'Older A', 'Synthetic description', 'archived', 'first_inbound_message', '{"keywords":[]}', NULL, '{}', 5, '2026-10-18 07:00:00+00', '2026-10-18 10:00:00+00', '2026-10-18 10:00:00+00'),
  ('30000000-0000-4000-8000-000000000004', '00000000-0000-4000-8000-000000000006', '10000000-0000-4000-8000-000000000001', 'Former member flow', NULL, 'active', 'keyword', '{}', NULL, '{}', 99, NULL, '2026-10-20 10:00:00+00', '2026-10-20 10:00:00+00'),
  ('30000000-0000-4000-8000-000000000005', '00000000-0000-4000-8000-000000000002', '10000000-0000-4000-8000-000000000002', 'Account B', 'Synthetic B', 'draft', 'manual', '{}', NULL, '{}', 2, NULL, '2026-10-21 10:00:00+00', '2026-10-21 10:00:00+00');
