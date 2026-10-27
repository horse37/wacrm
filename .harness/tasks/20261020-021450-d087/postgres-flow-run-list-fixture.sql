CREATE ROLE wacrm_flow_run_list_runtime
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
  status text NOT NULL DEFAULT 'draft',
  trigger_config jsonb NOT NULL DEFAULT '{}'::jsonb,
  fallback_policy jsonb NOT NULL DEFAULT '{}'::jsonb
);

CREATE TABLE public.contacts (
  id uuid PRIMARY KEY,
  user_id uuid NOT NULL,
  account_id uuid NOT NULL REFERENCES public.accounts(id),
  name text,
  phone text NOT NULL,
  email text
);

CREATE TABLE public.flow_runs (
  id uuid PRIMARY KEY,
  flow_id uuid NOT NULL REFERENCES public.flows(id),
  account_id uuid NOT NULL REFERENCES public.accounts(id),
  user_id uuid NOT NULL,
  contact_id uuid REFERENCES public.contacts(id) ON DELETE SET NULL,
  conversation_id uuid,
  last_prompt_message_id uuid,
  status text NOT NULL CHECK (status IN (
    'active', 'completed', 'handed_off', 'timed_out', 'paused_by_agent', 'failed'
  )),
  current_node_key text,
  vars jsonb NOT NULL DEFAULT '{}'::jsonb,
  reprompt_count integer NOT NULL DEFAULT 0,
  started_at timestamptz NOT NULL,
  last_advanced_at timestamptz NOT NULL,
  ended_at timestamptz,
  end_reason text
);

ALTER TABLE public.accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.accounts FORCE ROW LEVEL SECURITY;
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.profiles FORCE ROW LEVEL SECURITY;
ALTER TABLE public.flows ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.flows FORCE ROW LEVEL SECURITY;
ALTER TABLE public.contacts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.contacts FORCE ROW LEVEL SECURITY;
ALTER TABLE public.flow_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.flow_runs FORCE ROW LEVEL SECURITY;

CREATE POLICY accounts_select_members
  ON public.accounts FOR SELECT TO wacrm_flow_run_list_runtime
  USING (public.is_account_member(id));
CREATE POLICY profiles_select_members
  ON public.profiles FOR SELECT TO wacrm_flow_run_list_runtime
  USING (auth.uid() = user_id OR public.is_account_member(account_id));
CREATE POLICY flows_select_members
  ON public.flows FOR SELECT TO wacrm_flow_run_list_runtime
  USING (public.is_account_member(account_id));
CREATE POLICY contacts_select_members
  ON public.contacts FOR SELECT TO wacrm_flow_run_list_runtime
  USING (public.is_account_member(account_id));
CREATE POLICY flow_runs_select_members
  ON public.flow_runs FOR SELECT TO wacrm_flow_run_list_runtime
  USING (public.is_account_member(account_id));

GRANT USAGE ON SCHEMA auth, public TO wacrm_flow_run_list_runtime;
GRANT EXECUTE ON FUNCTION auth.uid() TO wacrm_flow_run_list_runtime;
GRANT EXECUTE ON FUNCTION public.is_account_member(uuid, public.account_role_enum)
  TO wacrm_flow_run_list_runtime;
GRANT SELECT (id, name) ON TABLE public.accounts TO wacrm_flow_run_list_runtime;
GRANT SELECT (user_id, account_id, account_role)
  ON TABLE public.profiles TO wacrm_flow_run_list_runtime;
GRANT SELECT (id, user_id, account_id, name)
  ON TABLE public.flows TO wacrm_flow_run_list_runtime;
GRANT SELECT (id, account_id, name, phone)
  ON TABLE public.contacts TO wacrm_flow_run_list_runtime;
GRANT SELECT (
  id, flow_id, account_id, user_id, contact_id, status, current_node_key,
  vars, reprompt_count, started_at, last_advanced_at, ended_at, end_reason
) ON TABLE public.flow_runs TO wacrm_flow_run_list_runtime;

INSERT INTO public.accounts (id, name, owner_user_id) VALUES
  ('10000000-0000-4000-8000-000000000001', 'Synthetic Account A', '00000000-0000-4000-8000-000000000001'),
  ('10000000-0000-4000-8000-000000000002', 'Synthetic Account B', '00000000-0000-4000-8000-000000000002'),
  ('10000000-0000-4000-8000-000000000003', 'Synthetic Account C', '00000000-0000-4000-8000-000000000004');

INSERT INTO public.profiles (id, user_id, account_id, account_role, full_name) VALUES
  ('20000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000001', 'owner', 'Synthetic Owner A'),
  ('20000000-0000-4000-8000-000000000003', '00000000-0000-4000-8000-000000000003', '10000000-0000-4000-8000-000000000001', 'viewer', 'Synthetic Viewer A'),
  ('20000000-0000-4000-8000-000000000005', '00000000-0000-4000-8000-000000000005', '10000000-0000-4000-8000-000000000001', 'agent', 'Synthetic Agent A'),
  ('20000000-0000-4000-8000-000000000002', '00000000-0000-4000-8000-000000000002', '10000000-0000-4000-8000-000000000002', 'owner', 'Synthetic Owner B'),
  ('20000000-0000-4000-8000-000000000004', '00000000-0000-4000-8000-000000000004', '10000000-0000-4000-8000-000000000003', 'admin', 'Synthetic Admin C');

INSERT INTO public.flows (id, user_id, account_id, name, description, status, trigger_config, fallback_policy) VALUES
  ('30000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000001', 'Synthetic flow A1', 'Not selected', 'active', '{"keywords":["synthetic"]}', '{"private":"not selected"}'),
  ('30000000-0000-4000-8000-000000000002', '00000000-0000-4000-8000-000000000002', '10000000-0000-4000-8000-000000000001', 'Mismatched creator', 'Not selected', 'draft', '{}', '{}'),
  ('30000000-0000-4000-8000-000000000004', '00000000-0000-4000-8000-000000000002', '10000000-0000-4000-8000-000000000002', 'Synthetic flow B1', 'Not selected', 'draft', '{}', '{}');

INSERT INTO public.contacts (id, user_id, account_id, name, phone, email) VALUES
  ('40000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000001', 'Synthetic Contact A', '+15555550100', 'private-a@example.invalid'),
  ('40000000-0000-4000-8000-000000000002', '00000000-0000-4000-8000-000000000002', '10000000-0000-4000-8000-000000000002', 'Synthetic Contact B', '+15555550200', 'private-b@example.invalid');

INSERT INTO public.flow_runs (
  id, flow_id, account_id, user_id, contact_id, status, current_node_key,
  vars, reprompt_count, started_at, last_advanced_at, ended_at, end_reason
)
SELECT
  ('50000000-0000-4000-8000-' || lpad(i::text, 12, '0'))::uuid,
  '30000000-0000-4000-8000-000000000001',
  '10000000-0000-4000-8000-000000000001',
  '00000000-0000-4000-8000-000000000001',
  CASE WHEN i = 55 THEN '40000000-0000-4000-8000-000000000001'::uuid ELSE NULL END,
  (ARRAY['active', 'completed', 'handed_off', 'timed_out', 'paused_by_agent', 'failed'])[(i % 6) + 1],
  CASE WHEN i % 6 = 0 THEN 'collect' ELSE NULL END,
  jsonb_build_object('batch', 'synthetic', 'ordinal', i),
  i % 4,
  '2026-10-20 12:00:00+00'::timestamptz,
  '2026-10-20 12:01:00+00'::timestamptz,
  CASE WHEN i % 6 = 0 THEN NULL ELSE '2026-10-20 12:01:00+00'::timestamptz END,
  CASE WHEN i % 6 = 0 THEN NULL ELSE 'synthetic_end' END
FROM generate_series(1, 55) AS seq(i);

-- This newer same-account run points at a contact from another account.
-- The run is visible; the mismatched contact must resolve to null.
INSERT INTO public.flow_runs (
  id, flow_id, account_id, user_id, contact_id, status, vars,
  reprompt_count, started_at, last_advanced_at
) VALUES (
  '50000000-0000-4000-8000-000000000056',
  '30000000-0000-4000-8000-000000000001',
  '10000000-0000-4000-8000-000000000001',
  '00000000-0000-4000-8000-000000000001',
  '40000000-0000-4000-8000-000000000002',
  'active', '{}', 0, '2026-10-22 12:00:00+00', '2026-10-22 12:00:00+00'
);

-- Creator mismatch would outrank every valid row without the author checks.
INSERT INTO public.flow_runs (
  id, flow_id, account_id, user_id, status, vars, reprompt_count,
  started_at, last_advanced_at
) VALUES (
  '50000000-0000-4000-8000-000000000057',
  '30000000-0000-4000-8000-000000000001',
  '10000000-0000-4000-8000-000000000001',
  '00000000-0000-4000-8000-000000000002',
  'active', '{}', 0, '2026-10-23 12:00:00+00', '2026-10-23 12:00:00+00'
);

-- Account mismatch for the same flow ID must remain invisible.
INSERT INTO public.flow_runs (
  id, flow_id, account_id, user_id, status, vars, reprompt_count,
  started_at, last_advanced_at
) VALUES (
  '50000000-0000-4000-8000-000000000058',
  '30000000-0000-4000-8000-000000000001',
  '10000000-0000-4000-8000-000000000002',
  '00000000-0000-4000-8000-000000000002',
  'active', '{}', 0, '2026-10-24 12:00:00+00', '2026-10-24 12:00:00+00'
);

-- Normal account-B run must not enter Account A's result.
INSERT INTO public.flow_runs (
  id, flow_id, account_id, user_id, status, vars, reprompt_count,
  started_at, last_advanced_at
) VALUES (
  '50000000-0000-4000-8000-000000000059',
  '30000000-0000-4000-8000-000000000004',
  '10000000-0000-4000-8000-000000000002',
  '00000000-0000-4000-8000-000000000002',
  'active', '{}', 0, '2026-10-25 12:00:00+00', '2026-10-25 12:00:00+00'
);
