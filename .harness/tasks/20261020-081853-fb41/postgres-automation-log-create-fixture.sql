CREATE ROLE wacrm_automation_log_create_job
  LOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS;

CREATE TABLE public.automation_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  automation_id uuid NOT NULL,
  account_id uuid NOT NULL,
  user_id uuid NOT NULL,
  contact_id uuid,
  trigger_event text NOT NULL,
  steps_executed jsonb NOT NULL DEFAULT '[]'::jsonb,
  status text NOT NULL CHECK (status IN ('success', 'partial', 'failed')),
  created_at timestamptz NOT NULL DEFAULT now(),
  private_payload text NOT NULL DEFAULT 'SYNTHETIC_PRIVATE_PAYLOAD',
  CHECK (account_id <> '10000000-0000-4000-8000-000000000002'::uuid)
);

ALTER TABLE public.automation_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.automation_logs FORCE ROW LEVEL SECURITY;

CREATE POLICY automation_log_create_select
  ON public.automation_logs
  FOR SELECT TO wacrm_automation_log_create_job
  USING (true);

CREATE POLICY automation_log_create_insert
  ON public.automation_logs
  FOR INSERT TO wacrm_automation_log_create_job
  WITH CHECK (true);

GRANT USAGE ON SCHEMA public TO wacrm_automation_log_create_job;
GRANT SELECT (id) ON TABLE public.automation_logs
  TO wacrm_automation_log_create_job;
GRANT INSERT (
  automation_id,
  account_id,
  user_id,
  contact_id,
  trigger_event,
  steps_executed,
  status
) ON TABLE public.automation_logs
  TO wacrm_automation_log_create_job;
