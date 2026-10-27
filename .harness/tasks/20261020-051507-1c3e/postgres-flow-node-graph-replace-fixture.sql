CREATE ROLE wacrm_flow_node_runtime
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
  account_id uuid NOT NULL REFERENCES public.accounts(id) ON DELETE CASCADE
);

CREATE TABLE public.flow_nodes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  flow_id uuid NOT NULL REFERENCES public.flows(id) ON DELETE CASCADE,
  node_key text NOT NULL,
  node_type text NOT NULL CHECK (node_type IN (
    'start', 'send_buttons', 'send_list', 'send_message', 'send_media', 'collect_input',
    'condition', 'set_tag', 'handoff', 'http_fetch', 'end'
  )),
  config jsonb NOT NULL DEFAULT '{}'::jsonb,
  position_x integer NOT NULL DEFAULT 0,
  position_y integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT NOW(),
  UNIQUE (flow_id, node_key)
);

CREATE FUNCTION public.reject_synthetic_flow_node()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.node_key = 'synthetic_fail' THEN
    RAISE EXCEPTION 'synthetic flow-node rollback probe' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END
$$;
CREATE TRIGGER reject_synthetic_flow_node
  BEFORE INSERT ON public.flow_nodes
  FOR EACH ROW EXECUTE FUNCTION public.reject_synthetic_flow_node();

ALTER TABLE public.accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.accounts FORCE ROW LEVEL SECURITY;
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.profiles FORCE ROW LEVEL SECURITY;
ALTER TABLE public.flows ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.flows FORCE ROW LEVEL SECURITY;
ALTER TABLE public.flow_nodes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.flow_nodes FORCE ROW LEVEL SECURITY;

CREATE POLICY accounts_select_members
  ON public.accounts FOR SELECT TO wacrm_flow_node_runtime
  USING (public.is_account_member(id));
CREATE POLICY profiles_select_members
  ON public.profiles FOR SELECT TO wacrm_flow_node_runtime
  USING (auth.uid() = user_id OR public.is_account_member(account_id));
CREATE POLICY flows_select_members
  ON public.flows FOR SELECT TO wacrm_flow_node_runtime
  USING (public.is_account_member(account_id));
CREATE POLICY flow_nodes_select_members
  ON public.flow_nodes FOR SELECT TO wacrm_flow_node_runtime
  USING (EXISTS (
    SELECT 1 FROM public.flows AS flow
    WHERE flow.id = flow_nodes.flow_id
      AND public.is_account_member(flow.account_id)
  ));
CREATE POLICY flow_nodes_modify_agents
  ON public.flow_nodes FOR ALL TO wacrm_flow_node_runtime
  USING (EXISTS (
    SELECT 1 FROM public.flows AS flow
    WHERE flow.id = flow_nodes.flow_id
      AND public.is_account_member(flow.account_id, 'agent')
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM public.flows AS flow
    WHERE flow.id = flow_nodes.flow_id
      AND public.is_account_member(flow.account_id, 'agent')
  ));

GRANT CONNECT ON DATABASE postgres TO wacrm_flow_node_runtime;
GRANT USAGE ON SCHEMA auth, public TO wacrm_flow_node_runtime;
GRANT USAGE ON TYPE public.account_role_enum TO wacrm_flow_node_runtime;
GRANT EXECUTE ON FUNCTION auth.uid() TO wacrm_flow_node_runtime;
GRANT EXECUTE ON FUNCTION public.is_account_member(uuid, public.account_role_enum)
  TO wacrm_flow_node_runtime;
GRANT SELECT (id, name) ON TABLE public.accounts TO wacrm_flow_node_runtime;
GRANT SELECT (user_id, account_id, account_role) ON TABLE public.profiles
  TO wacrm_flow_node_runtime;
GRANT SELECT (id, user_id, account_id) ON TABLE public.flows
  TO wacrm_flow_node_runtime;
GRANT SELECT (flow_id) ON TABLE public.flow_nodes TO wacrm_flow_node_runtime;
GRANT DELETE ON TABLE public.flow_nodes TO wacrm_flow_node_runtime;
GRANT INSERT (flow_id, node_key, node_type, config, position_x, position_y)
  ON TABLE public.flow_nodes TO wacrm_flow_node_runtime;

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
INSERT INTO public.flows (id, user_id, account_id) VALUES
  ('70000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000001'),
  ('70000000-0000-4000-8000-000000000002', '00000000-0000-4000-8000-000000000004', '10000000-0000-4000-8000-000000000002');
INSERT INTO public.flow_nodes (id, flow_id, node_key, node_type, config) VALUES
  ('80000000-0000-4000-8000-000000000001', '70000000-0000-4000-8000-000000000001', 'old', 'end', '{}'::jsonb),
  ('80000000-0000-4000-8000-000000000002', '70000000-0000-4000-8000-000000000002', 'keep', 'end', '{}'::jsonb);
