CREATE ROLE wacrm_automation_finalize_job
  LOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS;

CREATE TABLE public.automation_pending_executions (
  id uuid PRIMARY KEY,
  status text NOT NULL CHECK (status IN ('pending', 'running', 'done', 'failed')),
  private_payload text NOT NULL DEFAULT 'SYNTHETIC_PRIVATE_PAYLOAD',
  CHECK (
    id <> '40000000-0000-4000-8000-000000000003'::uuid
    OR status <> 'failed'
  )
);

ALTER TABLE public.automation_pending_executions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.automation_pending_executions FORCE ROW LEVEL SECURITY;

CREATE POLICY automation_pending_finalize_select
  ON public.automation_pending_executions
  FOR SELECT TO wacrm_automation_finalize_job
  USING (status IN ('running', 'done', 'failed'));

CREATE POLICY automation_pending_finalize_update
  ON public.automation_pending_executions
  FOR UPDATE TO wacrm_automation_finalize_job
  USING (status = 'running')
  WITH CHECK (status IN ('done', 'failed'));

GRANT USAGE ON SCHEMA public TO wacrm_automation_finalize_job;
GRANT SELECT (id, status) ON TABLE public.automation_pending_executions
  TO wacrm_automation_finalize_job;
GRANT UPDATE (status) ON TABLE public.automation_pending_executions
  TO wacrm_automation_finalize_job;

INSERT INTO public.automation_pending_executions (id, status) VALUES
  ('40000000-0000-4000-8000-000000000001', 'running'),
  ('40000000-0000-4000-8000-000000000002', 'running'),
  ('40000000-0000-4000-8000-000000000003', 'running'),
  ('40000000-0000-4000-8000-000000000004', 'pending'),
  ('40000000-0000-4000-8000-000000000005', 'done');
