-- TEST ONLY: task-owned disposable PostgreSQL. Never apply to a persistent database.
GRANT EXECUTE ON FUNCTION public.record_zap_lead_sse_event(
  UUID,
  TEXT,
  UUID,
  UUID,
  TEXT,
  TIMESTAMPTZ
) TO wacrm_runtime;
