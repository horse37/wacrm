CREATE ROLE wacrm_automation_pending_finalize_tenant_job
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

REVOKE ALL ON FUNCTION public.wacrm_request_user_id() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.is_account_member(uuid, public.account_role_enum) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.is_account_member(uuid, public.account_role_enum)
TO wacrm_automation_pending_finalize_tenant_job;

CREATE TABLE public.automation_pending_executions (
  id uuid PRIMARY KEY,
  account_id uuid NOT NULL REFERENCES public.accounts(id),
  user_id uuid NOT NULL REFERENCES public.profiles(user_id),
  status text NOT NULL CHECK (status IN ('pending', 'running', 'done', 'failed')),
  private_payload text NOT NULL DEFAULT 'SYNTHETIC_PRIVATE_PAYLOAD',
  CONSTRAINT reject_synthetic_pending_finalize CHECK (
    NOT (
      id = '40000000-0000-4000-8000-000000000003'::uuid
      AND status = 'failed'
    )
  )
);

ALTER TABLE public.automation_pending_executions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.automation_pending_executions FORCE ROW LEVEL SECURITY;

CREATE POLICY automation_pending_finalize_tenant_select
ON public.automation_pending_executions
FOR SELECT
TO wacrm_automation_pending_finalize_tenant_job
USING (public.is_account_member(account_id));

CREATE POLICY automation_pending_finalize_tenant_update
ON public.automation_pending_executions
FOR UPDATE
TO wacrm_automation_pending_finalize_tenant_job
USING (public.is_account_member(account_id, 'agent'))
WITH CHECK (public.is_account_member(account_id, 'agent'));

GRANT CONNECT ON DATABASE postgres TO wacrm_automation_pending_finalize_tenant_job;
GRANT USAGE ON SCHEMA public TO wacrm_automation_pending_finalize_tenant_job;
GRANT USAGE ON TYPE public.account_role_enum TO wacrm_automation_pending_finalize_tenant_job;
GRANT SELECT (id, account_id, user_id, status)
ON public.automation_pending_executions
TO wacrm_automation_pending_finalize_tenant_job;
GRANT UPDATE (status)
ON public.automation_pending_executions
TO wacrm_automation_pending_finalize_tenant_job;

INSERT INTO public.accounts (id) VALUES
  ('10000000-0000-4000-8000-000000000001'),
  ('10000000-0000-4000-8000-000000000002'),
  ('10000000-0000-4000-8000-000000000003');

INSERT INTO public.profiles (user_id, account_id, account_role) VALUES
  ('30000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000001', 'owner'),
  ('30000000-0000-4000-8000-000000000002', '10000000-0000-4000-8000-000000000002', 'owner'),
  ('30000000-0000-4000-8000-000000000003', '10000000-0000-4000-8000-000000000003', 'owner'),
  ('30000000-0000-4000-8000-000000000004', '10000000-0000-4000-8000-000000000001', 'viewer'),
  ('30000000-0000-4000-8000-000000000005', '10000000-0000-4000-8000-000000000001', 'agent');

INSERT INTO public.automation_pending_executions (id, account_id, user_id, status) VALUES
  ('40000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000001', '30000000-0000-4000-8000-000000000001', 'running'),
  ('40000000-0000-4000-8000-000000000002', '10000000-0000-4000-8000-000000000001', '30000000-0000-4000-8000-000000000001', 'running'),
  ('40000000-0000-4000-8000-000000000003', '10000000-0000-4000-8000-000000000001', '30000000-0000-4000-8000-000000000001', 'running'),
  ('40000000-0000-4000-8000-000000000004', '10000000-0000-4000-8000-000000000002', '30000000-0000-4000-8000-000000000002', 'running'),
  ('40000000-0000-4000-8000-000000000005', '10000000-0000-4000-8000-000000000001', '30000000-0000-4000-8000-000000000005', 'running'),
  ('40000000-0000-4000-8000-000000000006', '10000000-0000-4000-8000-000000000001', '30000000-0000-4000-8000-000000000004', 'running');
