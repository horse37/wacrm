CREATE ROLE wacrm_automation_delete_runtime
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

CREATE TABLE public.automations (
  id uuid PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES auth.users(id),
  account_id uuid NOT NULL REFERENCES public.accounts(id),
  name text NOT NULL,
  description text,
  trigger_type text NOT NULL,
  trigger_config jsonb NOT NULL DEFAULT '{}'::jsonb,
  is_active boolean NOT NULL DEFAULT false,
  execution_count integer NOT NULL DEFAULT 0,
  last_executed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.automation_steps (
  id uuid PRIMARY KEY,
  automation_id uuid NOT NULL REFERENCES public.automations(id) ON DELETE CASCADE,
  parent_step_id uuid REFERENCES public.automation_steps(id) ON DELETE CASCADE,
  branch text CHECK (branch IN ('yes', 'no')),
  step_type text NOT NULL,
  step_config jsonb NOT NULL DEFAULT '{}'::jsonb,
  position integer NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.automation_logs (
  id uuid PRIMARY KEY,
  automation_id uuid NOT NULL REFERENCES public.automations(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id),
  account_id uuid NOT NULL REFERENCES public.accounts(id),
  trigger_event text NOT NULL,
  steps_executed jsonb NOT NULL DEFAULT '[]'::jsonb,
  status text NOT NULL CHECK (status IN ('success', 'partial', 'failed')),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.automation_pending_executions (
  id uuid PRIMARY KEY,
  automation_id uuid NOT NULL REFERENCES public.automations(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id),
  account_id uuid NOT NULL REFERENCES public.accounts(id),
  log_id uuid REFERENCES public.automation_logs(id) ON DELETE CASCADE,
  parent_step_id uuid REFERENCES public.automation_steps(id) ON DELETE SET NULL,
  next_step_position integer NOT NULL,
  context jsonb NOT NULL DEFAULT '{}'::jsonb,
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'running', 'done', 'failed')),
  run_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.accounts FORCE ROW LEVEL SECURITY;
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.profiles FORCE ROW LEVEL SECURITY;
ALTER TABLE public.automations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.automations FORCE ROW LEVEL SECURITY;
ALTER TABLE public.automation_steps ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.automation_steps FORCE ROW LEVEL SECURITY;
ALTER TABLE public.automation_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.automation_logs FORCE ROW LEVEL SECURITY;
ALTER TABLE public.automation_pending_executions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.automation_pending_executions FORCE ROW LEVEL SECURITY;

CREATE POLICY accounts_select_members
  ON public.accounts FOR SELECT TO wacrm_automation_delete_runtime
  USING (public.is_account_member(id));
CREATE POLICY profiles_select_members
  ON public.profiles FOR SELECT TO wacrm_automation_delete_runtime
  USING (auth.uid() = user_id OR public.is_account_member(account_id));
CREATE POLICY automations_select_members
  ON public.automations FOR SELECT TO wacrm_automation_delete_runtime
  USING (public.is_account_member(account_id));
CREATE POLICY automations_delete_agents
  ON public.automations FOR DELETE TO wacrm_automation_delete_runtime
  USING (public.is_account_member(account_id, 'agent'));
CREATE POLICY automation_steps_select_members
  ON public.automation_steps FOR SELECT TO wacrm_automation_delete_runtime
  USING (
    EXISTS (
      SELECT 1
      FROM public.automations AS a
      WHERE a.id = automation_steps.automation_id
        AND public.is_account_member(a.account_id)
    )
  );
CREATE POLICY automation_steps_modify_agents
  ON public.automation_steps FOR ALL TO wacrm_automation_delete_runtime
  USING (
    EXISTS (
      SELECT 1
      FROM public.automations AS a
      WHERE a.id = automation_steps.automation_id
        AND public.is_account_member(a.account_id, 'agent')
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM public.automations AS a
      WHERE a.id = automation_steps.automation_id
        AND public.is_account_member(a.account_id, 'agent')
    )
  );

REVOKE ALL ON SCHEMA public, auth FROM PUBLIC;
REVOKE ALL ON ALL TABLES IN SCHEMA public FROM PUBLIC;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA public, auth FROM PUBLIC;
REVOKE ALL ON DATABASE postgres FROM PUBLIC;
GRANT CONNECT ON DATABASE postgres TO wacrm_automation_delete_runtime;
GRANT USAGE ON SCHEMA auth, public TO wacrm_automation_delete_runtime;
GRANT USAGE ON TYPE public.account_role_enum TO wacrm_automation_delete_runtime;
GRANT EXECUTE ON FUNCTION auth.uid() TO wacrm_automation_delete_runtime;
GRANT EXECUTE ON FUNCTION public.is_account_member(uuid, public.account_role_enum)
  TO wacrm_automation_delete_runtime;
GRANT SELECT (id, name) ON TABLE public.accounts
  TO wacrm_automation_delete_runtime;
GRANT SELECT (user_id, account_id, account_role) ON TABLE public.profiles
  TO wacrm_automation_delete_runtime;
GRANT SELECT (id, user_id, account_id), DELETE ON TABLE public.automations
  TO wacrm_automation_delete_runtime;

INSERT INTO auth.users (id) VALUES
  ('00000000-0000-4000-8000-000000000001'),
  ('00000000-0000-4000-8000-000000000002'),
  ('00000000-0000-4000-8000-000000000003'),
  ('00000000-0000-4000-8000-000000000004');

INSERT INTO public.accounts (id, name, owner_user_id) VALUES
  ('10000000-0000-4000-8000-000000000001', 'Synthetic Account A', '00000000-0000-4000-8000-000000000001'),
  ('10000000-0000-4000-8000-000000000002', 'Synthetic Account B', '00000000-0000-4000-8000-000000000002');

INSERT INTO public.profiles (user_id, account_id, account_role) VALUES
  ('00000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000001', 'owner'),
  ('00000000-0000-4000-8000-000000000002', '10000000-0000-4000-8000-000000000002', 'owner'),
  ('00000000-0000-4000-8000-000000000003', '10000000-0000-4000-8000-000000000001', 'agent'),
  ('00000000-0000-4000-8000-000000000004', '10000000-0000-4000-8000-000000000001', 'viewer');

INSERT INTO public.automations (id, user_id, account_id, name, trigger_type) VALUES
  ('30000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000003', '10000000-0000-4000-8000-000000000001', 'Agent automation A', 'new_message_received'),
  ('30000000-0000-4000-8000-000000000002', '00000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000001', 'Owner automation A', 'tag_added'),
  ('30000000-0000-4000-8000-000000000003', '00000000-0000-4000-8000-000000000002', '10000000-0000-4000-8000-000000000002', 'Owner automation B', 'keyword_match'),
  ('30000000-0000-4000-8000-000000000004', '00000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000002', 'Inconsistent creator', 'tag_added'),
  ('30000000-0000-4000-8000-000000000005', '00000000-0000-4000-8000-000000000003', '10000000-0000-4000-8000-000000000001', 'Race automation A', 'tag_added'),
  ('30000000-0000-4000-8000-000000000006', '00000000-0000-4000-8000-000000000004', '10000000-0000-4000-8000-000000000001', 'Viewer automation A', 'tag_added'),
  ('30000000-0000-4000-8000-000000000007', '00000000-0000-4000-8000-000000000003', '10000000-0000-4000-8000-000000000001', 'Identity cleanup automation A', 'tag_added');

INSERT INTO public.automation_steps (id, automation_id, step_type, position) VALUES
  ('40000000-0000-4000-8000-000000000001', '30000000-0000-4000-8000-000000000001', 'send_message', 0),
  ('40000000-0000-4000-8000-000000000002', '30000000-0000-4000-8000-000000000002', 'send_message', 0),
  ('40000000-0000-4000-8000-000000000003', '30000000-0000-4000-8000-000000000003', 'send_message', 0),
  ('40000000-0000-4000-8000-000000000004', '30000000-0000-4000-8000-000000000005', 'send_message', 0);

INSERT INTO public.automation_logs (
  id, automation_id, user_id, account_id, trigger_event, status
) VALUES
  ('50000000-0000-4000-8000-000000000001', '30000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000003', '10000000-0000-4000-8000-000000000001', 'synthetic_target', 'success'),
  ('50000000-0000-4000-8000-000000000002', '30000000-0000-4000-8000-000000000002', '00000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000001', 'synthetic_owner', 'success'),
  ('50000000-0000-4000-8000-000000000003', '30000000-0000-4000-8000-000000000003', '00000000-0000-4000-8000-000000000002', '10000000-0000-4000-8000-000000000002', 'synthetic_other_account', 'success');

INSERT INTO public.automation_pending_executions (
  id, automation_id, user_id, account_id, log_id, parent_step_id,
  next_step_position, run_at
) VALUES
  ('60000000-0000-4000-8000-000000000001', '30000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000003', '10000000-0000-4000-8000-000000000001', '50000000-0000-4000-8000-000000000001', '40000000-0000-4000-8000-000000000001', 1, '2026-10-21 00:00:00+00'),
  ('60000000-0000-4000-8000-000000000002', '30000000-0000-4000-8000-000000000003', '00000000-0000-4000-8000-000000000002', '10000000-0000-4000-8000-000000000002', '50000000-0000-4000-8000-000000000003', '40000000-0000-4000-8000-000000000003', 1, '2026-10-21 00:00:00+00');
