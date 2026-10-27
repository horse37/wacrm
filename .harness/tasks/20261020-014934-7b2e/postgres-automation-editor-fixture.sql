CREATE ROLE wacrm_automation_editor_runtime
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

CREATE TABLE public.automations (
  id uuid PRIMARY KEY,
  user_id uuid NOT NULL,
  account_id uuid NOT NULL REFERENCES public.accounts(id),
  name text NOT NULL,
  description text,
  trigger_type text NOT NULL,
  trigger_config jsonb NOT NULL DEFAULT '{}'::jsonb,
  is_active boolean NOT NULL DEFAULT false,
  execution_count integer NOT NULL DEFAULT 0,
  last_executed_at timestamptz,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL
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

ALTER TABLE public.accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.accounts FORCE ROW LEVEL SECURITY;
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.profiles FORCE ROW LEVEL SECURITY;
ALTER TABLE public.automations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.automations FORCE ROW LEVEL SECURITY;
ALTER TABLE public.automation_steps ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.automation_steps FORCE ROW LEVEL SECURITY;

CREATE POLICY accounts_select_members
  ON public.accounts FOR SELECT TO wacrm_automation_editor_runtime
  USING (public.is_account_member(id));
CREATE POLICY profiles_select_members
  ON public.profiles FOR SELECT TO wacrm_automation_editor_runtime
  USING (auth.uid() = user_id OR public.is_account_member(account_id));
CREATE POLICY automations_select_members
  ON public.automations FOR SELECT TO wacrm_automation_editor_runtime
  USING (public.is_account_member(account_id));
CREATE POLICY automation_steps_select_members
  ON public.automation_steps FOR SELECT TO wacrm_automation_editor_runtime
  USING (
    EXISTS (
      SELECT 1
      FROM public.automations AS a
      WHERE a.id = automation_steps.automation_id
        AND public.is_account_member(a.account_id)
    )
  );

GRANT USAGE ON SCHEMA auth, public TO wacrm_automation_editor_runtime;
GRANT EXECUTE ON FUNCTION auth.uid() TO wacrm_automation_editor_runtime;
GRANT EXECUTE ON FUNCTION public.is_account_member(uuid, public.account_role_enum)
  TO wacrm_automation_editor_runtime;
GRANT SELECT (id, name) ON TABLE public.accounts TO wacrm_automation_editor_runtime;
GRANT SELECT (user_id, account_id, account_role)
  ON TABLE public.profiles TO wacrm_automation_editor_runtime;
GRANT SELECT (id, user_id, account_id, name, description, trigger_type, trigger_config, is_active)
  ON TABLE public.automations TO wacrm_automation_editor_runtime;
GRANT SELECT (id, automation_id, parent_step_id, branch, step_type, step_config, position)
  ON TABLE public.automation_steps TO wacrm_automation_editor_runtime;

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

INSERT INTO public.automations (
  id, user_id, account_id, name, description, trigger_type, trigger_config,
  is_active, execution_count, last_executed_at, created_at, updated_at
) VALUES
  ('30000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000001', 'Editor A', NULL, 'new_message_received', '{"keywords":["synthetic"],"hook":"https://synthetic.invalid/hook"}', true, 17, '2026-10-19 10:00:00+00', '2026-10-18 10:00:00+00', '2026-10-19 10:00:00+00'),
  ('30000000-0000-4000-8000-000000000002', '00000000-0000-4000-8000-000000000002', '10000000-0000-4000-8000-000000000001', 'Mismatched creator', NULL, 'tag_added', '{}', false, 0, NULL, '2026-10-18 10:00:00+00', '2026-10-18 10:00:00+00'),
  ('30000000-0000-4000-8000-000000000003', '00000000-0000-4000-8000-000000000002', '10000000-0000-4000-8000-000000000002', 'Editor B', 'Account B', 'keyword_match', '{}', false, 9, NULL, '2026-10-18 10:00:00+00', '2026-10-18 10:00:00+00'),
  ('30000000-0000-4000-8000-000000000004', '00000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000001', 'Empty editor', 'No steps', 'tag_added', '{}', false, 0, NULL, '2026-10-17 10:00:00+00', '2026-10-17 10:00:00+00'),
  ('30000000-0000-4000-8000-000000000005', '00000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000001', 'Corrupt tree', NULL, 'tag_added', '{}', false, 0, NULL, '2026-10-17 10:00:00+00', '2026-10-17 10:00:00+00');

INSERT INTO public.automation_steps (
  id, automation_id, parent_step_id, branch, step_type, step_config, position
) VALUES
  ('40000000-0000-4000-8000-000000000001', '30000000-0000-4000-8000-000000000001', NULL, NULL, 'condition', '{"subject":"message","operand":"contains"}', 0),
  ('40000000-0000-4000-8000-000000000002', '30000000-0000-4000-8000-000000000001', NULL, NULL, 'send_message', '{"text":"synthetic root"}', 1),
  ('40000000-0000-4000-8000-000000000003', '30000000-0000-4000-8000-000000000001', '40000000-0000-4000-8000-000000000001', 'yes', 'add_tag', '{"tag_id":"synthetic-tag"}', 0),
  ('40000000-0000-4000-8000-000000000004', '30000000-0000-4000-8000-000000000001', '40000000-0000-4000-8000-000000000001', 'no', 'send_message', '{"text":"synthetic no branch"}', 0),
  ('40000000-0000-4000-8000-000000000005', '30000000-0000-4000-8000-000000000001', '40000000-0000-4000-8000-000000000001', 'yes', 'wait', '{"amount":1,"unit":"minutes"}', 0),
  ('40000000-0000-4000-8000-000000000006', '30000000-0000-4000-8000-000000000001', '40000000-0000-4000-8000-000000000001', NULL, 'send_message', '{"text":"legacy yes branch"}', 1),
  ('40000000-0000-4000-8000-000000000007', '30000000-0000-4000-8000-000000000005', '40000000-0000-4000-8000-000000000003', 'yes', 'send_message', '{}', 0);
