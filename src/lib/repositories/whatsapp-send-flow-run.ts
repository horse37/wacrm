import 'server-only';
import type { QueryResultRow } from 'pg';
import { AppError } from '../db/errors';
import { withTransaction } from '../db/postgres-client';

interface PausedFlowRunRow extends QueryResultRow {
  id: string;
}

export interface VerifiedWhatsAppSendFlowRunAccount {
  userId: string;
  accountId: string;
}

function isUuid(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
      value
    )
  );
}

/** Pause any active Flow run before sending an agent's WhatsApp reply. */
export function createPostgresWhatsAppSendFlowRunRepository(
  account: VerifiedWhatsAppSendFlowRunAccount
): {
  pauseActiveForAgentReply: (
    contactId: unknown,
    endedAt: unknown
  ) => Promise<boolean>;
} {
  async function pauseActiveForAgentReply(
    contactId: unknown,
    endedAt: unknown
  ): Promise<boolean> {
    if (
      !isUuid(account.userId) ||
      !isUuid(account.accountId) ||
      !isUuid(contactId) ||
      typeof endedAt !== 'string' ||
      !Number.isFinite(Date.parse(endedAt))
    ) {
      return false;
    }

    const userId = account.userId.toLowerCase();
    const accountId = account.accountId.toLowerCase();
    const normalizedContactId = contactId.toLowerCase();
    const result = await withTransaction(async (transaction) => {
      await transaction.query(
        "SELECT set_config('request.jwt.claim.sub', $1, true)",
        [userId]
      );

      const active = await transaction.query<PausedFlowRunRow>(
        `SELECT id::text AS id
         FROM public.flow_runs
         WHERE account_id = $1::uuid
           AND contact_id = $2::uuid
           AND status = 'active'
         ORDER BY id
         LIMIT 2`,
        [accountId, normalizedContactId]
      );

      if (active.rows.length === 0) return false;
      if (active.rows.length !== 1 || !isUuid(active.rows[0]?.id)) {
        throw new AppError('db_error');
      }

      const updated = await transaction.query<PausedFlowRunRow>(
        `UPDATE public.flow_runs
         SET status = 'paused_by_agent',
             ended_at = $3::timestamptz,
             end_reason = 'agent_replied'
         WHERE account_id = $1::uuid
           AND contact_id = $2::uuid
           AND status = 'active'
         RETURNING id::text AS id`,
        [accountId, normalizedContactId, endedAt]
      );

      if (updated.rows.length !== 1 || !isUuid(updated.rows[0]?.id)) {
        throw new AppError('db_error');
      }
      return true;
    });

    if (!result.ok) throw result.error;
    return result.data;
  }

  return { pauseActiveForAgentReply };
}
