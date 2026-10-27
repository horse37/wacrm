CREATE ROLE wacrm_automation_pending_schedule_tenant_job
  LOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS;

CREATE TYPE public.account_role_enum AS ENUM ('owner', 'admin', 'agent', 'viewer');

CREATE TABLE public.accounts (
  id uuid PRIMARY KEY
);

CREATE TABLE public.profiles (
  user_id uuid PRIMARY KEY,
  account_id uuid NOT NULL REFERENCES public.accounts(id),
  account_role public.account_role_enum NOT NULL
);

CREATE TABLE public.automations (
  id uuid PRIMARY KEY,
  account_id uuid NOT NULL REFERENCES public.accounts(id),
  user_id uuid NOT NULL REFERENCES public.profiles(user_id)
);

CREATE FUNCTION public.wacrm_request_user_id()
RETURNS uuid
LANGUAGE sql
STABLE
AS $$
  SELECT NULLIF(current_setting('request.jwt.claim.sub', true), '')::uuid;
$$;

CREATE FUNCTION public.is_account_member(
  target_account_id uuid,
  min_role public.account_role_enum DEFAULT 'viewer'
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.profiles AS p
    WHERE p.user_id = public.wacrm_request_user_id()
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
  );
$$;

CREATE FUNCTION public.is_automation_writer(
  target_automation_id uuid,
  target_account_id uuid
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.automations AS a
    WHERE a.id = target_automation_id
      AND a.account_id = target_account_id
      AND a.user_id = public.wacrm_request_user_id()
  );
$$;

REVOKE ALL ON FUNCTION public.wacrm_request_user_id() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.is_account_member(uuid, public.account_role_enum) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.is_automation_writer(uuid, uuid) FROM PUBLIC;

CREATE TABLE public.automation_pending_executions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  automation_id uuid NOT NULL,
  account_id uuid NOT NULL REFERENCES public.accounts(id),
  user_id uuid NOT NULL REFERENCES public.profiles(user_id),
  contact_id uuid,
  log_id uuid,
  parent_step_id uuid,
  branch text CHECK (branch IN ('yes', 'no')),
  next_step_position integer NOT NULL CHECK (next_step_position >= 0),
  context jsonb NOT NULL DEFAULT '{}'::jsonb,
  status text NOT NULL CHECK (status IN ('pending', 'running', 'done', 'failed')),
  run_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  private_payload text NOT NULL DEFAULT 'SYNTHETIC_PRIVATE_PAYLOAD',
  CHECK (context->>'fixture_reject' IS DISTINCT FROM 'true')
);

ALTER TABLE public.automation_pending_executions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.automation_pending_executions FORCE ROW LEVEL SECURITY;

CREATE POLICY automation_pending_schedule_tenant_select
  ON public.automation_pending_executions
  FOR SELECT TO wacrm_automation_pending_schedule_tenant_job
  USING (public.is_account_member(account_id));

CREATE POLICY automation_pending_schedule_tenant_insert
  ON public.automation_pending_executions
  FOR INSERT TO wacrm_automation_pending_schedule_tenant_job
  WITH CHECK (
    public.is_account_member(account_id, 'agent')
    AND user_id = public.wacrm_request_user_id()
    AND public.is_automation_writer(automation_id, account_id)
  );

REVOKE ALL ON FUNCTION public.wacrm_request_user_id() FROM PUBLIC;
GRANT CONNECT ON DATABASE postgres TO wacrm_automation_pending_schedule_tenant_job;
GRANT USAGE ON SCHEMA public TO wacrm_automation_pending_schedule_tenant_job;
GRANT USAGE ON TYPE public.account_role_enum TO wacrm_automation_pending_schedule_tenant_job;
GRANT EXECUTE ON FUNCTION public.wacrm_request_user_id()
  TO wacrm_automation_pending_schedule_tenant_job;
GRANT EXECUTE ON FUNCTION public.is_account_member(uuid, public.account_role_enum)
  TO wacrm_automation_pending_schedule_tenant_job;
GRANT EXECUTE ON FUNCTION public.is_automation_writer(uuid, uuid)
  TO wacrm_automation_pending_schedule_tenant_job;
GRANT SELECT (id) ON TABLE public.automation_pending_executions
  TO wacrm_automation_pending_schedule_tenant_job;
GRANT INSERT (
  automation_id,
  account_id,
  user_id,
  contact_id,
  log_id,
  parent_step_id,
  branch,
  next_step_position,
  context,
  run_at,
  status
) ON TABLE public.automation_pending_executions
  TO wacrm_automation_pending_schedule_tenant_job;

INSERT INTO public.accounts VALUES
  ('10000000-0000-4000-8000-000000000001'),
  ('10000000-0000-4000-8000-000000000002'),
  ('10000000-0000-4000-8000-000000000003');

INSERT INTO public.profiles VALUES
  ('00000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000001', 'owner'),
  ('00000000-0000-4000-8000-000000000002', '10000000-0000-4000-8000-000000000002', 'owner'),
  ('00000000-0000-4000-8000-000000000003', '10000000-0000-4000-8000-000000000001', 'viewer'),
  ('00000000-0000-4000-8000-000000000004', '10000000-0000-4000-8000-000000000001', 'agent');

INSERT INTO public.automations VALUES
  ('30000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000001'),
  ('30000000-0000-4000-8000-000000000002', '10000000-0000-4000-8000-000000000002', '00000000-0000-4000-8000-000000000002');
