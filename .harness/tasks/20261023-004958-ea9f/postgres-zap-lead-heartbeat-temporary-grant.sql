-- TEST ONLY: task-owned disposable PostgreSQL. Never apply to a persistent database.
GRANT EXECUTE ON FUNCTION public.record_zap_lead_health_success(
  UUID,
  TEXT,
  TIMESTAMPTZ
) TO wacrm_runtime;

GRANT EXECUTE ON FUNCTION public.record_zap_lead_health_failure(
  UUID,
  TEXT,
  TEXT,
  TIMESTAMPTZ
) TO wacrm_runtime;

GRANT EXECUTE ON FUNCTION public.claim_zap_lead_heartbeat_alert(
  UUID,
  TEXT,
  TIMESTAMPTZ
) TO wacrm_runtime;