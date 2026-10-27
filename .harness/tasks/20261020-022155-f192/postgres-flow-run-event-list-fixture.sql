CREATE ROLE wacrm_flow_run_event_list_runtime
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
  fallback_policy jsonb NOT NULL DEFAULT '{}'::jsonb
);

CREATE TABLE public.flow_runs (
  id uuid PRIMARY KEY,
  flow_id uuid NOT NULL REFERENCES public.flows(id),
  account_id uuid NOT NULL REFERENCES public.accounts(id),
  user_id uuid NOT NULL,
  started_at timestamptz NOT NULL,
  status text NOT NULL DEFAULT 'completed'
);

CREATE TABLE public.flow_run_events (
  id uuid PRIMARY KEY,
  flow_run_id uuid NOT NULL REFERENCES public.flow_runs(id),
  event_type text NOT NULL CHECK (event_type IN (
    'started', 'node_entered', 'message_sent', 'reply_received',
    'fallback_fired', 'handoff', 'timeout', 'error', 'completed'
  )),
  node_key text,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL
);

ALTER TABLE public.accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.accounts FORCE ROW LEVEL SECURITY;
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.profiles FORCE ROW LEVEL SECURITY;
ALTER TABLE public.flows ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.flows FORCE ROW LEVEL SECURITY;
ALTER TABLE public.flow_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.flow_runs FORCE ROW LEVEL SECURITY;
ALTER TABLE public.flow_run_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.flow_run_events FORCE ROW LEVEL SECURITY;

CREATE POLICY accounts_select_members
  ON public.accounts FOR SELECT TO wacrm_flow_run_event_list_runtime
  USING (public.is_account_member(id));
CREATE POLICY profiles_select_members
  ON public.profiles FOR SELECT TO wacrm_flow_run_event_list_runtime
  USING (auth.uid() = user_id OR public.is_account_member(account_id));
CREATE POLICY flows_select_members
  ON public.flows FOR SELECT TO wacrm_flow_run_event_list_runtime
  USING (public.is_account_member(account_id));
CREATE POLICY flow_runs_select_members
  ON public.flow_runs FOR SELECT TO wacrm_flow_run_event_list_runtime
  USING (public.is_account_member(account_id));
CREATE POLICY flow_run_events_select_members
  ON public.flow_run_events FOR SELECT TO wacrm_flow_run_event_list_runtime
  USING (
    EXISTS (
      SELECT 1 FROM public.flow_runs AS r
      WHERE r.id = flow_run_events.flow_run_id
        AND public.is_account_member(r.account_id)
    )
  );

GRANT USAGE ON SCHEMA auth, public TO wacrm_flow_run_event_list_runtime;
GRANT EXECUTE ON FUNCTION auth.uid() TO wacrm_flow_run_event_list_runtime;
GRANT EXECUTE ON FUNCTION public.is_account_member(uuid, public.account_role_enum)
  TO wacrm_flow_run_event_list_runtime;
GRANT SELECT (id, name) ON TABLE public.accounts TO wacrm_flow_run_event_list_runtime;
GRANT SELECT (user_id, account_id, account_role)
  ON TABLE public.profiles TO wacrm_flow_run_event_list_runtime;
GRANT SELECT (id, user_id, account_id)
  ON TABLE public.flows TO wacrm_flow_run_event_list_runtime;
GRANT SELECT (id, flow_id, account_id, user_id, started_at)
  ON TABLE public.flow_runs TO wacrm_flow_run_event_list_runtime;
GRANT SELECT (id, flow_run_id, event_type, node_key, payload, created_at)
  ON TABLE public.flow_run_events TO wacrm_flow_run_event_list_runtime;

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

INSERT INTO public.flows (id, user_id, account_id, name, description, fallback_policy) VALUES
  ('30000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000001', 'Synthetic flow A1', 'Not selected', '{"private":"not selected"}'),
  ('30000000-0000-4000-8000-000000000002', '00000000-0000-4000-8000-000000000002', '10000000-0000-4000-8000-000000000001', 'Mismatched creator', 'Not selected', '{}'),
  ('30000000-0000-4000-8000-000000000004', '00000000-0000-4000-8000-000000000002', '10000000-0000-4000-8000-000000000002', 'Synthetic flow B1', 'Not selected', '{}');

INSERT INTO public.flow_runs (id, flow_id, account_id, user_id, started_at)
SELECT
  ('50000000-0000-4000-8000-' || lpad(i::text, 12, '0'))::uuid,
  '30000000-0000-4000-8000-000000000001',
  '10000000-0000-4000-8000-000000000001',
  '00000000-0000-4000-8000-000000000001',
  '2026-10-20 12:00:00+00'::timestamptz
FROM generate_series(1, 55) AS seq(i);

-- These newer rows are excluded by flow/account/profile consistency.
INSERT INTO public.flow_runs (id, flow_id, account_id, user_id, started_at) VALUES
  ('50000000-0000-4000-8000-000000000057', '30000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000002', '2026-10-26 12:00:00+00'),
  ('50000000-0000-4000-8000-000000000058', '30000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000002', '00000000-0000-4000-8000-000000000002', '2026-10-27 12:00:00+00'),
  ('50000000-0000-4000-8000-000000000059', '30000000-0000-4000-8000-000000000004', '10000000-0000-4000-8000-000000000002', '00000000-0000-4000-8000-000000000002', '2026-10-28 12:00:00+00');

INSERT INTO public.flow_run_events (id, flow_run_id, event_type, node_key, payload, created_at) VALUES
  ('60000000-0000-4000-8000-000000000001', '50000000-0000-4000-8000-000000000054', 'node_entered', 'start', '{"node_type":"start"}', '2026-10-19 12:00:00+00'),
  ('60000000-0000-4000-8000-000000000002', '50000000-0000-4000-8000-000000000055', 'started', 'start', '{"source":"synthetic"}', '2026-10-20 12:00:00+00'),
  ('60000000-0000-4000-8000-000000000003', '50000000-0000-4000-8000-000000000055', 'reply_received', NULL, '{"reply_id":"synthetic-yes"}', '2026-10-20 12:00:00+00'),
  ('60000000-0000-4000-8000-000000000004', '50000000-0000-4000-8000-000000000006', 'completed', 'end', '{}', '2026-10-22 12:00:00+00'),
  ('60000000-0000-4000-8000-000000000005', '50000000-0000-4000-8000-000000000005', 'error', 'private', '{"reason":"excluded-old-run"}', '2026-10-18 12:00:00+00'),
  ('60000000-0000-4000-8000-000000000006', '50000000-0000-4000-8000-000000000057', 'error', 'private', '{"reason":"excluded-author"}', '2026-10-26 12:00:00+00'),
  ('60000000-0000-4000-8000-000000000007', '50000000-0000-4000-8000-000000000058', 'error', 'private', '{"reason":"excluded-account"}', '2026-10-27 12:00:00+00'),
  ('60000000-0000-4000-8000-000000000008', '50000000-0000-4000-8000-000000000059', 'error', 'private', '{"reason":"excluded-flow"}', '2026-10-28 12:00:00+00');
