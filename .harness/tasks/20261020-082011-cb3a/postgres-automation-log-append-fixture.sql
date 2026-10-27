CREATE ROLE wacrm_automation_log_append_job LOGIN NOBYPASSRLS;

CREATE TABLE public.automation_logs (
  id uuid PRIMARY KEY,
  account_id uuid NOT NULL,
  user_id uuid NOT NULL,
  steps_executed jsonb NOT NULL,
  status text NOT NULL,
  error_message text,
  private_payload text NOT NULL,
  CONSTRAINT reject_synthetic_log_update CHECK (
    NOT (status = 'failed' AND error_message = 'SYNTHETIC_REJECT')
  )
);

ALTER TABLE public.automation_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.automation_logs FORCE ROW LEVEL SECURITY;

CREATE POLICY automation_log_append_select
  ON public.automation_logs
  FOR SELECT
  TO wacrm_automation_log_append_job
  USING (true);

CREATE POLICY automation_log_append_update
  ON public.automation_logs
  FOR UPDATE
  TO wacrm_automation_log_append_job
  USING (true)
  WITH CHECK (true);

GRANT CONNECT ON DATABASE postgres TO wacrm_automation_log_append_job;
GRANT USAGE ON SCHEMA public TO wacrm_automation_log_append_job;
GRANT SELECT (id, account_id, user_id, steps_executed, status, error_message)
  ON public.automation_logs TO wacrm_automation_log_append_job;
GRANT UPDATE (steps_executed, status, error_message)
  ON public.automation_logs TO wacrm_automation_log_append_job;

INSERT INTO public.automation_logs (
  id, account_id, user_id, steps_executed, status, error_message, private_payload
) VALUES
  (
    '60000000-0000-4000-8000-000000000001',
    '20000000-0000-4000-8000-000000000001',
    '30000000-0000-4000-8000-000000000001',
    '[{"step_id":"50000000-0000-4000-8000-000000000000","step_type":"wait","status":"success"}]'::jsonb,
    'success',
    'ORIGINAL_ERROR',
    'SYNTHETIC_PRIVATE_PAYLOAD'
  ),
  (
    '60000000-0000-4000-8000-000000000002',
    '20000000-0000-4000-8000-000000000001',
    '30000000-0000-4000-8000-000000000001',
    '[]'::jsonb,
    'partial',
    'PRESERVE_ERROR',
    'SYNTHETIC_PRIVATE_PAYLOAD'
  ),
  (
    '60000000-0000-4000-8000-000000000003',
    '20000000-0000-4000-8000-000000000001',
    '30000000-0000-4000-8000-000000000001',
    '{"invalid":"shape"}'::jsonb,
    'success',
    NULL,
    'SYNTHETIC_PRIVATE_PAYLOAD'
  ),
  (
    '60000000-0000-4000-8000-000000000004',
    '20000000-0000-4000-8000-000000000001',
    '30000000-0000-4000-8000-000000000001',
    '[]'::jsonb,
    'success',
    'ROLLBACK_ORIGINAL_ERROR',
    'SYNTHETIC_PRIVATE_PAYLOAD'
  );
