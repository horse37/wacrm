ALTER TABLE public.zap_lead_integration_state
ADD COLUMN IF NOT EXISTS integration_key_id TEXT;

UPDATE public.zap_lead_integration_state AS state
SET integration_key_id = integration.key_id
FROM public.zap_lead_integrations AS integration
WHERE integration.account_id = state.account_id
  AND state.integration_key_id IS NULL;

DROP FUNCTION IF EXISTS public.record_zap_lead_health_success(UUID, TIMESTAMPTZ);
DROP FUNCTION IF EXISTS public.record_zap_lead_health_failure(UUID, TEXT, TIMESTAMPTZ);
DROP FUNCTION IF EXISTS public.claim_zap_lead_heartbeat_alert(UUID, TIMESTAMPTZ);

CREATE OR REPLACE FUNCTION public.record_zap_lead_sse_event(
  p_account_id UUID,
  p_key_id TEXT,
  p_expected_cursor UUID,
  p_event_id UUID,
  p_event_type TEXT,
  p_occurred_at TIMESTAMPTZ
)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_rows INTEGER;
  v_cursor_rows INTEGER;
BEGIN
  IF p_event_type NOT IN ('conversation.message.created', 'lead.stage.changed') THEN
    RETURN 'invalid';
  END IF;

  PERFORM 1
  FROM public.zap_lead_integrations
  WHERE account_id = p_account_id AND key_id = p_key_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RETURN 'invalid';
  END IF;

  INSERT INTO public.zap_lead_event_receipts (
    account_id, event_id, event_type, occurred_at, source
  ) VALUES (
    p_account_id, p_event_id, p_event_type, p_occurred_at, 'sse'
  )
  ON CONFLICT (account_id, event_id) DO NOTHING;
  GET DIAGNOSTICS v_rows = ROW_COUNT;

  INSERT INTO public.zap_lead_integration_state (
    account_id, integration_key_id, last_sse_cursor_id, updated_at
  ) VALUES (p_account_id, p_key_id, p_event_id, NOW())
  ON CONFLICT (account_id) DO UPDATE SET
    integration_key_id = EXCLUDED.integration_key_id,
    last_sse_cursor_id = EXCLUDED.last_sse_cursor_id,
    last_success_at = CASE
      WHEN public.zap_lead_integration_state.integration_key_id
        IS DISTINCT FROM EXCLUDED.integration_key_id THEN NULL
      ELSE public.zap_lead_integration_state.last_success_at
    END,
    last_failure_at = CASE
      WHEN public.zap_lead_integration_state.integration_key_id
        IS DISTINCT FROM EXCLUDED.integration_key_id THEN NULL
      ELSE public.zap_lead_integration_state.last_failure_at
    END,
    last_error_code = CASE
      WHEN public.zap_lead_integration_state.integration_key_id
        IS DISTINCT FROM EXCLUDED.integration_key_id THEN NULL
      ELSE public.zap_lead_integration_state.last_error_code
    END,
    alert_sent_at = CASE
      WHEN public.zap_lead_integration_state.integration_key_id
        IS DISTINCT FROM EXCLUDED.integration_key_id THEN NULL
      ELSE public.zap_lead_integration_state.alert_sent_at
    END,
    updated_at = EXCLUDED.updated_at
  WHERE public.zap_lead_integration_state.integration_key_id
      IS DISTINCT FROM p_key_id
    OR public.zap_lead_integration_state.last_sse_cursor_id
      IS NOT DISTINCT FROM p_expected_cursor;
  GET DIAGNOSTICS v_cursor_rows = ROW_COUNT;

  IF v_cursor_rows = 0 THEN
    RETURN 'stale';
  END IF;

  RETURN CASE WHEN v_rows = 0 THEN 'duplicate' ELSE 'accepted' END;
END;
$$;

CREATE OR REPLACE FUNCTION public.record_zap_lead_health_success(
  p_account_id UUID,
  p_key_id TEXT,
  p_checked_at TIMESTAMPTZ DEFAULT NOW()
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  PERFORM 1
  FROM public.zap_lead_integrations
  WHERE account_id = p_account_id AND key_id = p_key_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RETURN FALSE;
  END IF;

  INSERT INTO public.zap_lead_integration_state (
    account_id, integration_key_id, last_success_at, last_failure_at,
    last_error_code, alert_sent_at, updated_at
  ) VALUES (
    p_account_id, p_key_id, p_checked_at, NULL, NULL, NULL, p_checked_at
  )
  ON CONFLICT (account_id) DO UPDATE SET
    integration_key_id = EXCLUDED.integration_key_id,
    last_success_at = CASE
      WHEN public.zap_lead_integration_state.integration_key_id
        IS DISTINCT FROM EXCLUDED.integration_key_id
        THEN EXCLUDED.last_success_at
      ELSE GREATEST(
        public.zap_lead_integration_state.last_success_at,
        EXCLUDED.last_success_at
      )
    END,
    last_failure_at = CASE
      WHEN public.zap_lead_integration_state.integration_key_id
        IS DISTINCT FROM EXCLUDED.integration_key_id
        OR public.zap_lead_integration_state.last_success_at IS NULL
        OR EXCLUDED.last_success_at >= public.zap_lead_integration_state.last_success_at
        THEN NULL
      ELSE public.zap_lead_integration_state.last_failure_at
    END,
    last_error_code = CASE
      WHEN public.zap_lead_integration_state.integration_key_id
        IS DISTINCT FROM EXCLUDED.integration_key_id
        OR public.zap_lead_integration_state.last_success_at IS NULL
        OR EXCLUDED.last_success_at >= public.zap_lead_integration_state.last_success_at
        THEN NULL
      ELSE public.zap_lead_integration_state.last_error_code
    END,
    alert_sent_at = CASE
      WHEN public.zap_lead_integration_state.integration_key_id
        IS DISTINCT FROM EXCLUDED.integration_key_id
        OR public.zap_lead_integration_state.last_success_at IS NULL
        OR EXCLUDED.last_success_at >= public.zap_lead_integration_state.last_success_at
        THEN NULL
      ELSE public.zap_lead_integration_state.alert_sent_at
    END,
    last_sse_cursor_id = CASE
      WHEN public.zap_lead_integration_state.integration_key_id
        IS DISTINCT FROM EXCLUDED.integration_key_id THEN NULL
      ELSE public.zap_lead_integration_state.last_sse_cursor_id
    END,
    updated_at = EXCLUDED.updated_at;
  RETURN TRUE;
END;
$$;

CREATE OR REPLACE FUNCTION public.record_zap_lead_health_failure(
  p_account_id UUID,
  p_key_id TEXT,
  p_error_code TEXT,
  p_failed_at TIMESTAMPTZ DEFAULT NOW()
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF p_error_code NOT IN ('health_request_failed', 'invalid_credentials') THEN
    RETURN FALSE;
  END IF;

  PERFORM 1
  FROM public.zap_lead_integrations
  WHERE account_id = p_account_id AND key_id = p_key_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RETURN FALSE;
  END IF;

  INSERT INTO public.zap_lead_integration_state (
    account_id, integration_key_id, last_failure_at, last_error_code, updated_at
  ) VALUES (
    p_account_id, p_key_id, p_failed_at, p_error_code, p_failed_at
  )
  ON CONFLICT (account_id) DO UPDATE SET
    integration_key_id = EXCLUDED.integration_key_id,
    last_success_at = CASE
      WHEN public.zap_lead_integration_state.integration_key_id
        IS DISTINCT FROM EXCLUDED.integration_key_id THEN NULL
      ELSE public.zap_lead_integration_state.last_success_at
    END,
    last_failure_at = EXCLUDED.last_failure_at,
    last_error_code = EXCLUDED.last_error_code,
    alert_sent_at = CASE
      WHEN public.zap_lead_integration_state.integration_key_id
        IS DISTINCT FROM EXCLUDED.integration_key_id THEN NULL
      ELSE public.zap_lead_integration_state.alert_sent_at
    END,
    last_sse_cursor_id = CASE
      WHEN public.zap_lead_integration_state.integration_key_id
        IS DISTINCT FROM EXCLUDED.integration_key_id THEN NULL
      ELSE public.zap_lead_integration_state.last_sse_cursor_id
    END,
    updated_at = EXCLUDED.updated_at;
  RETURN TRUE;
END;
$$;

CREATE OR REPLACE FUNCTION public.claim_zap_lead_heartbeat_alert(
  p_account_id UUID,
  p_key_id TEXT,
  p_now TIMESTAMPTZ DEFAULT NOW()
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_created_at TIMESTAMPTZ;
  v_last_success_at TIMESTAMPTZ;
  v_alert_sent_at TIMESTAMPTZ;
  v_claimed BOOLEAN := FALSE;
BEGIN
  SELECT created_at
  INTO v_created_at
  FROM public.zap_lead_integrations
  WHERE account_id = p_account_id AND key_id = p_key_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RETURN FALSE;
  END IF;

  SELECT last_success_at, alert_sent_at
  INTO v_last_success_at, v_alert_sent_at
  FROM public.zap_lead_integration_state
  WHERE account_id = p_account_id AND integration_key_id = p_key_id;
  IF NOT FOUND THEN
    v_last_success_at := NULL;
    v_alert_sent_at := NULL;
  END IF;

  IF COALESCE(v_last_success_at, v_created_at) > p_now - INTERVAL '10 minutes'
    OR v_alert_sent_at IS NOT NULL THEN
    RETURN FALSE;
  END IF;

  INSERT INTO public.zap_lead_integration_state (
    account_id, integration_key_id, alert_sent_at, updated_at
  ) VALUES (p_account_id, p_key_id, p_now, p_now)
  ON CONFLICT (account_id) DO UPDATE SET
    integration_key_id = EXCLUDED.integration_key_id,
    last_success_at = CASE
      WHEN public.zap_lead_integration_state.integration_key_id
        IS DISTINCT FROM EXCLUDED.integration_key_id THEN NULL
      ELSE public.zap_lead_integration_state.last_success_at
    END,
    last_failure_at = CASE
      WHEN public.zap_lead_integration_state.integration_key_id
        IS DISTINCT FROM EXCLUDED.integration_key_id THEN NULL
      ELSE public.zap_lead_integration_state.last_failure_at
    END,
    last_error_code = CASE
      WHEN public.zap_lead_integration_state.integration_key_id
        IS DISTINCT FROM EXCLUDED.integration_key_id THEN NULL
      ELSE public.zap_lead_integration_state.last_error_code
    END,
    alert_sent_at = EXCLUDED.alert_sent_at,
    last_sse_cursor_id = CASE
      WHEN public.zap_lead_integration_state.integration_key_id
        IS DISTINCT FROM EXCLUDED.integration_key_id THEN NULL
      ELSE public.zap_lead_integration_state.last_sse_cursor_id
    END,
    updated_at = EXCLUDED.updated_at
  WHERE public.zap_lead_integration_state.integration_key_id
      IS DISTINCT FROM p_key_id
    OR public.zap_lead_integration_state.alert_sent_at IS NULL
  RETURNING TRUE INTO v_claimed;
  RETURN COALESCE(v_claimed, FALSE);
END;
$$;

REVOKE ALL ON FUNCTION public.record_zap_lead_sse_event(
  UUID, TEXT, UUID, UUID, TEXT, TIMESTAMPTZ
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.record_zap_lead_sse_event(
  UUID, TEXT, UUID, UUID, TEXT, TIMESTAMPTZ
) TO service_role;

REVOKE ALL ON FUNCTION public.record_zap_lead_health_success(
  UUID, TEXT, TIMESTAMPTZ
) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.record_zap_lead_health_failure(
  UUID, TEXT, TEXT, TIMESTAMPTZ
) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.claim_zap_lead_heartbeat_alert(
  UUID, TEXT, TIMESTAMPTZ
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.record_zap_lead_health_success(
  UUID, TEXT, TIMESTAMPTZ
) TO service_role;
GRANT EXECUTE ON FUNCTION public.record_zap_lead_health_failure(
  UUID, TEXT, TEXT, TIMESTAMPTZ
) TO service_role;
GRANT EXECUTE ON FUNCTION public.claim_zap_lead_heartbeat_alert(
  UUID, TEXT, TIMESTAMPTZ
) TO service_role;
