import 'server-only';

import type { QueryResultRow } from 'pg';

import { withTransaction } from '../db/postgres-client';

type ZapLeadSseReceiptStatus = 'accepted' | 'duplicate' | 'invalid' | 'stale';

interface ReceiptStatusRow extends QueryResultRow {
  status: unknown;
}

interface ZapLeadSseEventReceipt {
  accountId: string;
  keyId: string;
  eventId: string;
  eventType: 'conversation.message.created' | 'lead.stage.changed';
  occurredAt: string;
}

const sseReceiptStatusQuery =
  'SELECT public.record_zap_lead_sse_event(' +
  '$1::uuid, $2::text, $3::uuid, $4::uuid, $5::text, $6::timestamptz' +
  ') AS status';

export async function recordZapLeadSseEventReceipt(
  receipt: ZapLeadSseEventReceipt,
  expectedCursor: string | null
): Promise<ZapLeadSseReceiptStatus> {
  const result = await withTransaction((transaction) =>
    transaction.query<ReceiptStatusRow>(sseReceiptStatusQuery, [
      receipt.accountId,
      receipt.keyId,
      expectedCursor,
      receipt.eventId,
      receipt.eventType,
      receipt.occurredAt,
    ])
  );

  if (!result.ok) {
    throw new Error('Could not persist Zap Lead SSE receipt');
  }

  const status = result.data.rows[0]?.status;
  if (
    status !== 'accepted' &&
    status !== 'duplicate' &&
    status !== 'invalid' &&
    status !== 'stale'
  ) {
    throw new Error('Zap Lead SSE receipt returned an invalid status');
  }

  return status;
}
