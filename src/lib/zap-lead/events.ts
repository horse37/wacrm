import {
  claimZapLeadHeartbeatAlert as claimZapLeadHeartbeatAlertInPostgres,
  recordZapLeadHealthFailure as recordZapLeadHealthFailureInPostgres,
  recordZapLeadHealthSuccess as recordZapLeadHealthSuccessInPostgres,
} from '../repositories/zap-lead-heartbeat';
import { acceptZapLeadWebhookReceipt } from '../repositories/zap-lead-webhook-receipt';
import { recordZapLeadSseEventReceipt } from '../repositories/zap-lead-sse-event-receipt';

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
  return acceptZapLeadWebhookReceipt(receipt);
}

export async function recordZapLeadSseEvent(
  receipt: ZapLeadSseEventReceipt,
  expectedCursor: string | null
): Promise<'accepted' | 'duplicate' | 'invalid' | 'stale'> {
  return recordZapLeadSseEventReceipt(receipt, expectedCursor);
}

export function recordZapLeadHealthSuccess(
  accountId: string,
  keyId: string,
  checkedAt: Date
): Promise<boolean> {
  return recordZapLeadHealthSuccessInPostgres(accountId, keyId, checkedAt);
}

export function recordZapLeadHealthFailure(
  accountId: string,
  keyId: string,
  errorCode: 'health_request_failed' | 'invalid_credentials',
  failedAt: Date
): Promise<boolean> {
  return recordZapLeadHealthFailureInPostgres(
    accountId,
    keyId,
    errorCode,
    failedAt
  );
}

export function claimZapLeadHeartbeatAlert(
  accountId: string,
  keyId: string,
  now: Date
): Promise<boolean> {
  return claimZapLeadHeartbeatAlertInPostgres(accountId, keyId, now);
}
