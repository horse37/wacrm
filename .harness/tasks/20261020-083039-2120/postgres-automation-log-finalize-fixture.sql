CREATE ROLE wacrm_automation_log_finalize_job LOGIN NOBYPASSRLS;

CREATE TABLE public.automation_logs (
  id uuid PRIMARY KEY,
  status text NOT NULL,
  error_message text,
  private_payload text NOT NULL,
  CONSTRAINT reject_synthetic_log_finalization CHECK (
    NOT (status = 'failed' AND error_message = 'SYNTHETIC_REJECT')
  )
);

ALTER TABLE public.automation_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.automation_logs FORCE ROW LEVEL SECURITY;

CREATE POLICY automation_log_finalize_select
  ON public.automation_logs
  FOR SELECT
  TO wacrm_automation_log_finalize_job
  USING (true);

CREATE POLICY automation_log_finalize_update
  ON public.automation_logs
  FOR UPDATE
  TO wacrm_automation_log_finalize_job
  USING (true)
  WITH CHECK (true);

GRANT CONNECT ON DATABASE postgres TO wacrm_automation_log_finalize_job;
GRANT USAGE ON SCHEMA public TO wacrm_automation_log_finalize_job;
GRANT SELECT (id)
  ON public.automation_logs TO wacrm_automation_log_finalize_job;
GRANT UPDATE (status, error_message)
  ON public.automation_logs TO wacrm_automation_log_finalize_job;

INSERT INTO public.automation_logs (
  id, status, error_message, private_payload
) VALUES
  (
    '70000000-0000-4000-8000-000000000001',
    'failed',
    'OLD_SUCCESS_ERROR',
    'SYNTHETIC_PRIVATE_PAYLOAD'
  ),
  (
    '70000000-0000-4000-8000-000000000002',
    'success',
    'OLD_FAILURE_ERROR',
    'SYNTHETIC_PRIVATE_PAYLOAD'
  ),
  (
    '70000000-0000-4000-8000-000000000003',
    'success',
    'OLD_PARTIAL_ERROR',
    'SYNTHETIC_PRIVATE_PAYLOAD'
  ),
  (
    '70000000-0000-4000-8000-000000000004',
    'success',
    'ROLLBACK_ORIGINAL_ERROR',
    'SYNTHETIC_PRIVATE_PAYLOAD'
  );
