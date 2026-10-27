CREATE ROLE wacrm_automation_create_runtime
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
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
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
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
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
  ON public.accounts FOR SELECT TO wacrm_automation_create_runtime
  USING (public.is_account_member(id));
CREATE POLICY profiles_select_members
  ON public.profiles FOR SELECT TO wacrm_automation_create_runtime
  USING (auth.uid() = user_id OR public.is_account_member(account_id));
CREATE POLICY automations_select_members
  ON public.automations FOR SELECT TO wacrm_automation_create_runtime
  USING (public.is_account_member(account_id));
CREATE POLICY automations_insert_agents
  ON public.automations FOR INSERT TO wacrm_automation_create_runtime
  WITH CHECK (public.is_account_member(account_id, 'agent'));
CREATE POLICY automation_steps_select_members
  ON public.automation_steps FOR SELECT TO wacrm_automation_create_runtime
  USING (
    EXISTS (
      SELECT 1
      FROM public.automations AS automation
      WHERE automation.id = automation_steps.automation_id
        AND public.is_account_member(automation.account_id)
    )
  );
CREATE POLICY automation_steps_modify_agents
  ON public.automation_steps FOR ALL TO wacrm_automation_create_runtime
  USING (
    EXISTS (
      SELECT 1
      FROM public.automations AS automation
      WHERE automation.id = automation_steps.automation_id
        AND public.is_account_member(automation.account_id, 'agent')
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM public.automations AS automation
      WHERE automation.id = automation_steps.automation_id
        AND public.is_account_member(automation.account_id, 'agent')
    )
  );

REVOKE ALL ON SCHEMA public, auth FROM PUBLIC;
REVOKE ALL ON ALL TABLES IN SCHEMA public FROM PUBLIC;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA public, auth FROM PUBLIC;
REVOKE ALL ON DATABASE postgres FROM PUBLIC;
GRANT CONNECT ON DATABASE postgres TO wacrm_automation_create_runtime;
GRANT USAGE ON SCHEMA auth, public TO wacrm_automation_create_runtime;
GRANT USAGE ON TYPE public.account_role_enum TO wacrm_automation_create_runtime;
GRANT EXECUTE ON FUNCTION auth.uid() TO wacrm_automation_create_runtime;
GRANT EXECUTE ON FUNCTION public.is_account_member(uuid, public.account_role_enum)
  TO wacrm_automation_create_runtime;
GRANT SELECT (id, name) ON TABLE public.accounts
  TO wacrm_automation_create_runtime;
GRANT SELECT (user_id, account_id, account_role) ON TABLE public.profiles
  TO wacrm_automation_create_runtime;
GRANT SELECT (
  id, user_id, account_id, name, description, trigger_type, trigger_config,
  is_active, execution_count, last_executed_at, created_at, updated_at
) ON TABLE public.automations TO wacrm_automation_create_runtime;
GRANT INSERT (
  id, user_id, account_id, name, description, trigger_type, trigger_config,
  is_active
) ON TABLE public.automations TO wacrm_automation_create_runtime;
GRANT SELECT (id, automation_id, parent_step_id, branch, step_type, step_config, position)
  ON TABLE public.automation_steps TO wacrm_automation_create_runtime;
GRANT INSERT (
  id, automation_id, parent_step_id, branch, step_type, step_config, position
) ON TABLE public.automation_steps TO wacrm_automation_create_runtime;

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

CREATE FUNCTION public.reject_synthetic_create_step()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.step_type = 'synthetic_reject' THEN
    RAISE EXCEPTION 'synthetic automation-create step failure';
  END IF;
  RETURN NEW;
END
$$;
CREATE TRIGGER reject_synthetic_create_step
  BEFORE INSERT ON public.automation_steps
  FOR EACH ROW EXECUTE FUNCTION public.reject_synthetic_create_step();
REVOKE ALL ON FUNCTION public.reject_synthetic_create_step() FROM PUBLIC;
