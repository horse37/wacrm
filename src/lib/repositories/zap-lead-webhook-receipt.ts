import 'server-only';

import type { QueryResultRow } from 'pg';
import { withTransaction } from '../db/postgres-client';

type ZapLeadWebhookReceiptStatus =
  | 'accepted'
  | 'duplicate'
  | 'replay'
  | 'invalid';

interface ReceiptStatusRow extends QueryResultRow {
  status: unknown;
}

interface ZapLeadWebhookReceipt {
  accountId: string;
  keyId: string;
  nonce: string;
  eventId: string;
  eventType: string;
  occurredAt: string;
}

const receiptStatusQuery =
  'SELECT public.accept_zap_lead_webhook_event(' +
  '$1::uuid, $2::text, $3::text, $4::uuid, $5::text, $6::timestamptz' +
  ') AS status';

export async function acceptZapLeadWebhookReceipt(
  receipt: ZapLeadWebhookReceipt
): Promise<ZapLeadWebhookReceiptStatus> {
  const result = await withTransaction((transaction) =>
    transaction.query<ReceiptStatusRow>(receiptStatusQuery, [
      receipt.accountId,
      receipt.keyId,
      receipt.nonce,
      receipt.eventId,
      receipt.eventType,
      receipt.occurredAt,
    ])
  );

  if (!result.ok) {
    throw new Error('Could not persist Zap Lead webhook receipt');
  }

  const status = result.data.rows[0]?.status;
  if (
    status !== 'accepted' &&
    status !== 'duplicate' &&
    status !== 'replay' &&
    status !== 'invalid'
  ) {
    throw new Error('Zap Lead webhook receipt returned an invalid status');
  }

  return status;
}
