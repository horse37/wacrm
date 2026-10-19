-- Technical delivery state only. Business payloads are never persisted here.
ALTER TABLE public.zap_lead_integrations
  ADD COLUMN IF NOT EXISTS key_id TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS zap_lead_integrations_key_id_uidx
  ON public.zap_lead_integrations (key_id)
  WHERE key_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS public.zap_lead_event_receipts (
  account_id UUID NOT NULL
    REFERENCES public.zap_lead_integrations(account_id) ON DELETE CASCADE,
  event_id UUID NOT NULL,
  event_type TEXT NOT NULL CHECK (event_type IN (
    'lead.created',
    'lead.stage.changed',
    'lead.stage.pending_confirmation',
    'response.deadline.exceeded',
    'lead.assigned',
    'seller.channel.disconnected',
    'analysis.completed',
    'conversation.message.created'
  )),
  occurred_at TIMESTAMPTZ NOT NULL,
  received_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  source TEXT NOT NULL CHECK (source IN ('webhook', 'sse')),
  PRIMARY KEY (account_id, event_id)
);

CREATE TABLE IF NOT EXISTS public.zap_lead_webhook_nonces (
  account_id UUID NOT NULL
    REFERENCES public.zap_lead_integrations(account_id) ON DELETE CASCADE,
  key_id TEXT NOT NULL,
  nonce TEXT NOT NULL,
  received_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (key_id, nonce)
);

CREATE INDEX IF NOT EXISTS zap_lead_webhook_nonces_received_at_idx
  ON public.zap_lead_webhook_nonces (received_at);

CREATE TABLE IF NOT EXISTS public.zap_lead_integration_state (
  account_id UUID PRIMARY KEY
    REFERENCES public.zap_lead_integrations(account_id) ON DELETE CASCADE,
  last_success_at TIMESTAMPTZ,
  last_failure_at TIMESTAMPTZ,
  last_error_code TEXT,
  alert_sent_at TIMESTAMPTZ,
  last_webhook_received_at TIMESTAMPTZ,
  last_event_id UUID,
  last_event_type TEXT,
  last_event_at TIMESTAMPTZ,
  last_sse_cursor_id UUID,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE public.zap_lead_integration_state
  ADD COLUMN IF NOT EXISTS last_sse_cursor_id UUID;

ALTER TABLE public.zap_lead_event_receipts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.zap_lead_webhook_nonces ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.zap_lead_integration_state ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "zap_lead_integration_state_admin_select"
  ON public.zap_lead_integration_state;
CREATE POLICY "zap_lead_integration_state_admin_select"
  ON public.zap_lead_integration_state
  FOR SELECT TO authenticated
  USING (public.is_account_member(account_id, 'admin'));

GRANT SELECT ON public.zap_lead_integration_state TO authenticated;
REVOKE ALL ON public.zap_lead_event_receipts FROM anon, authenticated;
REVOKE ALL ON public.zap_lead_webhook_nonces FROM anon, authenticated;
GRANT ALL ON public.zap_lead_event_receipts TO service_role;
GRANT ALL ON public.zap_lead_webhook_nonces TO service_role;
GRANT ALL ON public.zap_lead_integration_state TO service_role;

CREATE OR REPLACE FUNCTION public.accept_zap_lead_webhook_event(
  p_account_id UUID,
  p_key_id TEXT,
  p_nonce TEXT,
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
BEGIN
 PERFORM 1
 FROM public.zap_lead_integrations
 WHERE account_id = p_account_id
   AND key_id = p_key_id
 FOR UPDATE;

 IF NOT FOUND THEN
  RETURN 'invalid';
 END IF;

  DELETE FROM public.zap_lead_webhook_nonces
  WHERE received_at < NOW() - INTERVAL '15 minutes';

  INSERT INTO public.zap_lead_webhook_nonces (account_id, key_id, nonce)
  VALUES (p_account_id, p_key_id, p_nonce)
  ON CONFLICT (key_id, nonce) DO NOTHING;
  GET DIAGNOSTICS v_rows = ROW_COUNT;

  IF v_rows = 0 THEN
    RETURN 'replay';
  END IF;

  INSERT INTO public.zap_lead_event_receipts (
    account_id, event_id, event_type, occurred_at, source
  )
  VALUES (p_account_id, p_event_id, p_event_type, p_occurred_at, 'webhook')
  ON CONFLICT (account_id, event_id) DO NOTHING;
  GET DIAGNOSTICS v_rows = ROW_COUNT;

  IF v_rows = 0 THEN
    INSERT INTO public.zap_lead_integration_state (
      account_id, last_webhook_received_at, updated_at
    )
    VALUES (p_account_id, NOW(), NOW())
    ON CONFLICT (account_id) DO UPDATE SET
      last_webhook_received_at = NOW(),
      updated_at = NOW();
    RETURN 'duplicate';
  END IF;

  INSERT INTO public.zap_lead_integration_state (
    account_id, last_webhook_received_at,
    last_event_id, last_event_type, last_event_at, updated_at
  )
  VALUES (
    p_account_id, NOW(),
    p_event_id, p_event_type, p_occurred_at, NOW()
  )
  ON CONFLICT (account_id) DO UPDATE SET
    last_webhook_received_at = NOW(),
    last_event_id = CASE
      WHEN public.zap_lead_integration_state.last_event_at IS NULL
        OR EXCLUDED.last_event_at >= public.zap_lead_integration_state.last_event_at
        THEN EXCLUDED.last_event_id
      ELSE public.zap_lead_integration_state.last_event_id
    END,
    last_event_type = CASE
      WHEN public.zap_lead_integration_state.last_event_at IS NULL
        OR EXCLUDED.last_event_at >= public.zap_lead_integration_state.last_event_at
        THEN EXCLUDED.last_event_type
      ELSE public.zap_lead_integration_state.last_event_type
    END,
    last_event_at = GREATEST(
      public.zap_lead_integration_state.last_event_at,
      EXCLUDED.last_event_at
    ),
    updated_at = NOW();

  RETURN 'accepted';
END;
$$;

REVOKE ALL ON FUNCTION public.accept_zap_lead_webhook_event(
  UUID, TEXT, TEXT, UUID, TEXT, TIMESTAMPTZ
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.accept_zap_lead_webhook_event(
  UUID, TEXT, TEXT, UUID, TEXT, TIMESTAMPTZ
) TO service_role;

DROP FUNCTION IF EXISTS public.record_zap_lead_sse_event(
  UUID, TEXT, UUID, TEXT, TIMESTAMPTZ
);

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
  )
  VALUES (p_account_id, p_event_id, p_event_type, p_occurred_at, 'sse')
  ON CONFLICT (account_id, event_id) DO NOTHING;
  GET DIAGNOSTICS v_rows = ROW_COUNT;

  INSERT INTO public.zap_lead_integration_state (
    account_id, last_sse_cursor_id, updated_at
  )
  VALUES (p_account_id, p_event_id, NOW())
  ON CONFLICT (account_id) DO UPDATE SET
    last_sse_cursor_id = EXCLUDED.last_sse_cursor_id,
    updated_at = EXCLUDED.updated_at
  WHERE public.zap_lead_integration_state.last_sse_cursor_id
    IS NOT DISTINCT FROM p_expected_cursor;
  GET DIAGNOSTICS v_cursor_rows = ROW_COUNT;

  IF v_cursor_rows = 0 THEN
    RETURN 'stale';
  END IF;

  RETURN CASE WHEN v_rows = 0 THEN 'duplicate' ELSE 'accepted' END;
END;
$$;

REVOKE ALL ON FUNCTION public.record_zap_lead_sse_event(
  UUID, TEXT, UUID, UUID, TEXT, TIMESTAMPTZ
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.record_zap_lead_sse_event(
  UUID, TEXT, UUID, UUID, TEXT, TIMESTAMPTZ
) TO service_role;

CREATE OR REPLACE FUNCTION public.record_zap_lead_health_success(
  p_account_id UUID,
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
 WHERE account_id = p_account_id
 FOR UPDATE;

 IF NOT FOUND THEN
    RETURN FALSE;
  END IF;

  INSERT INTO public.zap_lead_integration_state (
    account_id, last_success_at, last_failure_at, last_error_code,
    alert_sent_at, updated_at
  )
  VALUES (p_account_id, p_checked_at, NULL, NULL, NULL, p_checked_at)
  ON CONFLICT (account_id) DO UPDATE SET
    last_success_at = GREATEST(
      public.zap_lead_integration_state.last_success_at,
      EXCLUDED.last_success_at
    ),
    last_failure_at = CASE
      WHEN public.zap_lead_integration_state.last_success_at IS NULL
        OR EXCLUDED.last_success_at >= public.zap_lead_integration_state.last_success_at
        THEN NULL
      ELSE public.zap_lead_integration_state.last_failure_at
    END,
    last_error_code = CASE
      WHEN public.zap_lead_integration_state.last_success_at IS NULL
        OR EXCLUDED.last_success_at >= public.zap_lead_integration_state.last_success_at
        THEN NULL
      ELSE public.zap_lead_integration_state.last_error_code
    END,
    alert_sent_at = CASE
      WHEN public.zap_lead_integration_state.last_success_at IS NULL
        OR EXCLUDED.last_success_at >= public.zap_lead_integration_state.last_success_at
        THEN NULL
      ELSE public.zap_lead_integration_state.alert_sent_at
    END,
    updated_at = EXCLUDED.updated_at;

  RETURN TRUE;
END;
$$;

CREATE OR REPLACE FUNCTION public.record_zap_lead_health_failure(
  p_account_id UUID,
  p_error_code TEXT,
  p_failed_at TIMESTAMPTZ DEFAULT NOW()
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
 PERFORM 1
 FROM public.zap_lead_integrations
 WHERE account_id = p_account_id
 FOR UPDATE;

 IF NOT FOUND THEN
    RETURN FALSE;
  END IF;

  INSERT INTO public.zap_lead_integration_state (
    account_id, last_failure_at, last_error_code, updated_at
  )
  VALUES (p_account_id, p_failed_at, p_error_code, p_failed_at)
  ON CONFLICT (account_id) DO UPDATE SET
    last_failure_at = EXCLUDED.last_failure_at,
    last_error_code = EXCLUDED.last_error_code,
    updated_at = EXCLUDED.updated_at;

  RETURN TRUE;
END;
$$;

CREATE OR REPLACE FUNCTION public.claim_zap_lead_heartbeat_alert(
  p_account_id UUID,
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
  WHERE account_id = p_account_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN FALSE;
  END IF;

  SELECT last_success_at, alert_sent_at
  INTO v_last_success_at, v_alert_sent_at
  FROM public.zap_lead_integration_state
  WHERE account_id = p_account_id;

  IF NOT FOUND THEN
    v_last_success_at := NULL;
    v_alert_sent_at := NULL;
  END IF;

  IF COALESCE(v_last_success_at, v_created_at) > p_now - INTERVAL '10 minutes'
    OR v_alert_sent_at IS NOT NULL THEN
    RETURN FALSE;
  END IF;

  INSERT INTO public.zap_lead_integration_state (
    account_id, alert_sent_at, updated_at
  )
  VALUES (p_account_id, p_now, p_now)
  ON CONFLICT (account_id) DO UPDATE SET
    alert_sent_at = EXCLUDED.alert_sent_at,
    updated_at = EXCLUDED.updated_at
  WHERE public.zap_lead_integration_state.alert_sent_at IS NULL
  RETURNING TRUE INTO v_claimed;

  RETURN COALESCE(v_claimed, FALSE);
END;
$$;

REVOKE ALL ON FUNCTION public.record_zap_lead_health_success(UUID, TIMESTAMPTZ)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.record_zap_lead_health_failure(UUID, TEXT, TIMESTAMPTZ)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.claim_zap_lead_heartbeat_alert(UUID, TIMESTAMPTZ)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.record_zap_lead_health_success(UUID, TIMESTAMPTZ)
  TO service_role;
GRANT EXECUTE ON FUNCTION public.record_zap_lead_health_failure(UUID, TEXT, TIMESTAMPTZ)
  TO service_role;
GRANT EXECUTE ON FUNCTION public.claim_zap_lead_heartbeat_alert(UUID, TIMESTAMPTZ)
  TO service_role;
