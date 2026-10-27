CREATE ROLE wacrm_automation_pending_claim_tenant_job
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
    FROM public.profiles AS profile
    WHERE profile.user_id = public.wacrm_request_user_id()
      AND profile.account_id = target_account_id
      AND CASE profile.account_role
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

REVOKE ALL ON FUNCTION public.wacrm_request_user_id() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.is_account_member(uuid, public.account_role_enum) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.is_account_member(uuid, public.account_role_enum)
  TO wacrm_automation_pending_claim_tenant_job;

CREATE TABLE public.automation_pending_executions (
  id uuid PRIMARY KEY,
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
  private_payload text NOT NULL DEFAULT 'SYNTHETIC_PRIVATE_PAYLOAD'
);

ALTER TABLE public.automation_pending_executions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.automation_pending_executions FORCE ROW LEVEL SECURITY;

CREATE POLICY automation_pending_claim_tenant_select
  ON public.automation_pending_executions
  FOR SELECT TO wacrm_automation_pending_claim_tenant_job
  USING (public.is_account_member(account_id, 'agent'));

CREATE POLICY automation_pending_claim_tenant_update
  ON public.automation_pending_executions
  FOR UPDATE TO wacrm_automation_pending_claim_tenant_job
  USING (
    public.is_account_member(account_id, 'agent')
    AND status = 'pending'
  )
  WITH CHECK (
    public.is_account_member(account_id, 'agent')
    AND status = 'running'
  );

GRANT CONNECT ON DATABASE postgres TO wacrm_automation_pending_claim_tenant_job;
GRANT USAGE ON SCHEMA public TO wacrm_automation_pending_claim_tenant_job;
GRANT USAGE ON TYPE public.account_role_enum TO wacrm_automation_pending_claim_tenant_job;
GRANT SELECT (
  id, automation_id, account_id, user_id, contact_id, log_id,
  parent_step_id, branch, next_step_position, context, status, run_at
)
  ON public.automation_pending_executions
  TO wacrm_automation_pending_claim_tenant_job;
GRANT UPDATE (status)
  ON public.automation_pending_executions
  TO wacrm_automation_pending_claim_tenant_job;

INSERT INTO public.accounts (id) VALUES
  ('10000000-0000-4000-8000-000000000001'),
  ('10000000-0000-4000-8000-000000000002'),
  ('10000000-0000-4000-8000-000000000003');

INSERT INTO public.profiles (user_id, account_id, account_role) VALUES
  ('30000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000001', 'owner'),
  ('30000000-0000-4000-8000-000000000002', '10000000-0000-4000-8000-000000000001', 'owner'),
  ('30000000-0000-4000-8000-000000000003', '10000000-0000-4000-8000-000000000001', 'agent'),
  ('30000000-0000-4000-8000-000000000004', '10000000-0000-4000-8000-000000000001', 'viewer'),
  ('30000000-0000-4000-8000-000000000005', '10000000-0000-4000-8000-000000000002', 'owner'),
  ('30000000-0000-4000-8000-000000000006', '10000000-0000-4000-8000-000000000002', 'agent'),
  ('30000000-0000-4000-8000-000000000007', '10000000-0000-4000-8000-000000000003', 'owner');

INSERT INTO public.automation_pending_executions (
  id, automation_id, account_id, user_id, next_step_position, context,
  status, run_at
) VALUES
  ('40000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000001', '30000000-0000-4000-8000-000000000001', 1, '{"vars":{"owner":"first"}}', 'pending', '2026-10-20T13:00:00Z'),
  ('40000000-0000-4000-8000-000000000002', '20000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000001', '30000000-0000-4000-8000-000000000002', 2, '{"vars":{"owner":"second"}}', 'pending', '2026-10-20T13:00:00Z'),
  ('40000000-0000-4000-8000-000000000003', '20000000-0000-4000-8000-000000000002', '10000000-0000-4000-8000-000000000002', '30000000-0000-4000-8000-000000000005', 3, '{}', 'pending', '2026-10-20T13:00:00Z'),
  ('40000000-0000-4000-8000-000000000004', '20000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000001', '30000000-0000-4000-8000-000000000001', 4, '{}', 'pending', '2026-10-20T13:30:00Z'),
  ('40000000-0000-4000-8000-000000000005', '20000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000001', '30000000-0000-4000-8000-000000000002', 5, '{}', 'pending', '2026-10-20T13:30:00Z'),
  ('40000000-0000-4000-8000-000000000006', '20000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000001', '30000000-0000-4000-8000-000000000001', 6, '{}', 'pending', '2026-10-20T15:00:00Z');

INSERT INTO public.automation_pending_executions (
  id, automation_id, account_id, user_id, next_step_position, status, run_at
)
SELECT
  ('40000000-0000-4000-8000-' || lpad(value::text, 12, '0'))::uuid,
  '20000000-0000-4000-8000-000000000001',
  '10000000-0000-4000-8000-000000000001',
  CASE WHEN value % 2 = 1
    THEN '30000000-0000-4000-8000-000000000001'::uuid
    ELSE '30000000-0000-4000-8000-000000000002'::uuid
  END,
  10,
  'pending',
  '2026-10-20T13:45:00Z'
FROM generate_series(101, 110) AS value;
