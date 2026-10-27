CREATE ROLE wacrm_flow_editor_load_runtime
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

CREATE TABLE public.flow_nodes (
  id uuid PRIMARY KEY,
  flow_id uuid NOT NULL REFERENCES public.flows(id) ON DELETE CASCADE,
  node_key text NOT NULL,
  node_type text NOT NULL CHECK (node_type IN (
    'start', 'send_buttons', 'send_list', 'send_message', 'send_media',
    'collect_input', 'condition', 'set_tag', 'handoff', 'http_fetch', 'end'
  )),
  config jsonb NOT NULL DEFAULT '{}'::jsonb,
  position_x integer NOT NULL DEFAULT 0,
  position_y integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL,
  UNIQUE (flow_id, node_key)
);

ALTER TABLE public.accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.accounts FORCE ROW LEVEL SECURITY;
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.profiles FORCE ROW LEVEL SECURITY;
ALTER TABLE public.flows ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.flows FORCE ROW LEVEL SECURITY;
ALTER TABLE public.flow_nodes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.flow_nodes FORCE ROW LEVEL SECURITY;

CREATE POLICY accounts_select_members
  ON public.accounts FOR SELECT TO wacrm_flow_editor_load_runtime
  USING (public.is_account_member(id));
CREATE POLICY profiles_select_members
  ON public.profiles FOR SELECT TO wacrm_flow_editor_load_runtime
  USING (auth.uid() = user_id OR public.is_account_member(account_id));
CREATE POLICY flows_select_members
  ON public.flows FOR SELECT TO wacrm_flow_editor_load_runtime
  USING (public.is_account_member(account_id));
CREATE POLICY flow_nodes_select_members
  ON public.flow_nodes FOR SELECT TO wacrm_flow_editor_load_runtime
  USING (
    EXISTS (
      SELECT 1 FROM public.flows AS f
      WHERE f.id = flow_nodes.flow_id
        AND public.is_account_member(f.account_id)
    )
  );

GRANT USAGE ON SCHEMA auth, public TO wacrm_flow_editor_load_runtime;
GRANT EXECUTE ON FUNCTION auth.uid() TO wacrm_flow_editor_load_runtime;
GRANT EXECUTE ON FUNCTION public.is_account_member(uuid, public.account_role_enum)
  TO wacrm_flow_editor_load_runtime;
GRANT SELECT (id, name) ON TABLE public.accounts TO wacrm_flow_editor_load_runtime;
GRANT SELECT (user_id, account_id, account_role)
  ON TABLE public.profiles TO wacrm_flow_editor_load_runtime;
GRANT SELECT (
  id, user_id, account_id, name, description, status, trigger_type,
  trigger_config, entry_node_id
) ON TABLE public.flows TO wacrm_flow_editor_load_runtime;
GRANT SELECT (
  id, flow_id, node_key, node_type, config, position_x, position_y, created_at
) ON TABLE public.flow_nodes TO wacrm_flow_editor_load_runtime;

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

INSERT INTO public.flows (
  id, user_id, account_id, name, description, status, trigger_type,
  trigger_config, entry_node_id, fallback_policy, execution_count,
  last_executed_at, created_at, updated_at
) VALUES
  ('30000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000001', 'Synthetic flow A1', NULL, 'draft', 'keyword', '{"keywords":["synthetic"]}', 'start', '{"private":"fallback marker"}', 12, '2026-10-19 11:00:00+00', '2026-10-19 10:00:00+00', '2026-10-19 11:00:00+00'),
  ('30000000-0000-4000-8000-000000000002', '00000000-0000-4000-8000-000000000005', '10000000-0000-4000-8000-000000000001', 'Synthetic flow A2', 'Agent flow', 'active', 'manual', '{}', NULL, '{}', 2, NULL, '2026-10-18 10:00:00+00', '2026-10-18 10:00:00+00'),
  ('30000000-0000-4000-8000-000000000003', '00000000-0000-4000-8000-000000000002', '10000000-0000-4000-8000-000000000001', 'Mismatched creator', NULL, 'active', 'keyword', '{}', NULL, '{}', 0, NULL, '2026-10-17 10:00:00+00', '2026-10-17 10:00:00+00'),
  ('30000000-0000-4000-8000-000000000004', '00000000-0000-4000-8000-000000000002', '10000000-0000-4000-8000-000000000002', 'Synthetic flow B1', 'Account B', 'draft', 'first_inbound_message', '{}', NULL, '{}', 0, NULL, '2026-10-21 10:00:00+00', '2026-10-21 10:00:00+00');

INSERT INTO public.flow_nodes (
  id, flow_id, node_key, node_type, config, position_x, position_y, created_at
) VALUES
  ('40000000-0000-4000-8000-000000000002', '30000000-0000-4000-8000-000000000001', 'message', 'send_message', '{"text":"Synthetic only","next_node_key":"end"}', -10, 20, '2026-10-19 10:00:00+00'),
  ('40000000-0000-4000-8000-000000000001', '30000000-0000-4000-8000-000000000001', 'start', 'start', '{"next_node_key":"message"}', 0, 0, '2026-10-19 10:00:00+00'),
  ('40000000-0000-4000-8000-000000000003', '30000000-0000-4000-8000-000000000001', 'end', 'end', '{}', 30, 20, '2026-10-19 11:00:00+00'),
  ('40000000-0000-4000-8000-000000000004', '30000000-0000-4000-8000-000000000002', 'agent-start', 'start', '{"next_node_key":"agent-end"}', 0, 0, '2026-10-18 10:00:00+00'),
  ('40000000-0000-4000-8000-000000000005', '30000000-0000-4000-8000-000000000004', 'account-b-start', 'start', '{"next_node_key":"account-b-end"}', 0, 0, '2026-10-21 10:00:00+00');
