CREATE ROLE wacrm_automation_schedule_job
  LOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS;

CREATE TABLE public.automation_pending_executions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  automation_id uuid NOT NULL,
  account_id uuid NOT NULL,
  user_id uuid NOT NULL,
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

CREATE POLICY automation_pending_schedule_select
  ON public.automation_pending_executions
  FOR SELECT TO wacrm_automation_schedule_job
  USING (true);

CREATE POLICY automation_pending_schedule_insert
  ON public.automation_pending_executions
  FOR INSERT TO wacrm_automation_schedule_job
  WITH CHECK (true);

GRANT USAGE ON SCHEMA public TO wacrm_automation_schedule_job;
GRANT SELECT (id) ON TABLE public.automation_pending_executions
  TO wacrm_automation_schedule_job;
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
  TO wacrm_automation_schedule_job;
