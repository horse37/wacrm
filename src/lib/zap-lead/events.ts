import { zapLeadAdminClient } from './admin-client';

export type ZapLeadWebhookResult =
  | 'accepted'
  | 'duplicate'
  | 'replay'
  | 'invalid';

export interface ZapLeadWebhookEventReceipt {
  accountId: string;
  keyId: string;
  nonce: string;
  eventId: string;
  eventType: string;
  occurredAt: string;
}

export interface ZapLeadSseEventReceipt {
  accountId: string;
  keyId: string;
  eventId: string;
  eventType: 'conversation.message.created' | 'lead.stage.changed';
  occurredAt: string;
}

export async function acceptZapLeadWebhookEvent(
  receipt: ZapLeadWebhookEventReceipt
): Promise<ZapLeadWebhookResult> {
  const { data, error } = await zapLeadAdminClient().rpc(
    'accept_zap_lead_webhook_event',
    {
      p_account_id: receipt.accountId,
      p_key_id: receipt.keyId,
      p_nonce: receipt.nonce,
      p_event_id: receipt.eventId,
      p_event_type: receipt.eventType,
      p_occurred_at: receipt.occurredAt,
    }
  );

  if (error) throw new Error('Could not persist Zap Lead webhook receipt');
  if (
    data !== 'accepted' &&
    data !== 'duplicate' &&
    data !== 'replay' &&
    data !== 'invalid'
  ) {
    throw new Error('Zap Lead webhook receipt returned an invalid status');
  }
  return data;
}

export async function recordZapLeadSseEvent(
  receipt: ZapLeadSseEventReceipt,
  expectedCursor: string | null
): Promise<'accepted' | 'duplicate' | 'invalid' | 'stale'> {
  const { data, error } = await zapLeadAdminClient().rpc(
    'record_zap_lead_sse_event',
    {
      p_account_id: receipt.accountId,
      p_key_id: receipt.keyId,
      p_expected_cursor: expectedCursor,
      p_event_id: receipt.eventId,
      p_event_type: receipt.eventType,
      p_occurred_at: receipt.occurredAt,
    }
  );

  if (error) throw new Error('Could not persist Zap Lead SSE receipt');
  if (
    data !== 'accepted' &&
    data !== 'duplicate' &&
    data !== 'invalid' &&
    data !== 'stale'
  ) {
    throw new Error('Zap Lead SSE receipt returned an invalid status');
  }
  return data;
}

export async function recordZapLeadHealthSuccess(
  accountId: string,
  keyId: string,
  checkedAt: Date
): Promise<boolean> {
  const { data, error } = await zapLeadAdminClient().rpc(
    'record_zap_lead_health_success',
    {
      p_account_id: accountId,
      p_key_id: keyId,
      p_checked_at: checkedAt.toISOString(),
    }
  );
  if (error || typeof data !== 'boolean') {
    throw new Error('Could not persist Zap Lead health success');
  }
  return data;
}

export async function recordZapLeadHealthFailure(
  accountId: string,
  keyId: string,
  errorCode: 'health_request_failed' | 'invalid_credentials',
  failedAt: Date
): Promise<boolean> {
  const { data, error } = await zapLeadAdminClient().rpc(
    'record_zap_lead_health_failure',
    {
      p_account_id: accountId,
      p_key_id: keyId,
      p_error_code: errorCode,
      p_failed_at: failedAt.toISOString(),
    }
  );
  if (error || typeof data !== 'boolean') {
    throw new Error('Could not persist Zap Lead health failure');
  }
  return data;
}

export async function claimZapLeadHeartbeatAlert(
  accountId: string,
  keyId: string,
  now: Date
): Promise<boolean> {
  const { data, error } = await zapLeadAdminClient().rpc(
    'claim_zap_lead_heartbeat_alert',
    {
      p_account_id: accountId,
      p_key_id: keyId,
      p_now: now.toISOString(),
    }
  );
  if (error || typeof data !== 'boolean') {
    throw new Error('Could not claim Zap Lead heartbeat alert');
  }
  return data;
}
