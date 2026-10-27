-- TEST ONLY: apply to the task-owned disposable PostgreSQL database.
-- This temporary grant is never a runtime provisioning change.
GRANT EXECUTE ON FUNCTION public.accept_zap_lead_webhook_event(
  UUID,
  TEXT,
  TEXT,
  UUID,
  TEXT,
  TIMESTAMPTZ
) TO wacrm_runtime;
