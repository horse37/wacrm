import 'server-only';

import type { QueryResultRow } from 'pg';
import type { AccountGuardDependencies } from '../auth/postgres-account-guard';
import { createDefaultPostgresAccountGuards } from '../auth/postgres-account-guard';
import { AppError } from '../db/errors';
import { withTransaction } from '../db/postgres-client';
import type { DealStatus } from '../../types';

interface UpdatedDealRow extends QueryResultRow {
  id: string;
  status: string;
}

const dealStatuses = new Set<DealStatus>(['open', 'won', 'lost']);

function requestedUuid(value: unknown): string {
  if (
    typeof value !== 'string' ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
      value
    )
  ) {
    throw new AppError('bad_request');
  }
  return value.toLowerCase();
}

/** Change only the status of one deal in the verified account. */
export function createPostgresPipelineDealStatusUpdateRepository(
  getVerifiedSession: AccountGuardDependencies['getVerifiedSession']
): {
  setStatus: (dealId: string, status: DealStatus) => Promise<void>;
} {
  const guards = createDefaultPostgresAccountGuards(getVerifiedSession);

  async function setStatus(
    dealIdInput: string,
    statusInput: DealStatus
  ): Promise<void> {
    const context = await guards.requireRole('agent');
    const dealId = requestedUuid(dealIdInput);
    if (!dealStatuses.has(statusInput)) throw new AppError('bad_request');

    const result = await withTransaction(async (transaction) => {
      // Existing RLS policies resolve auth.uid() from this transaction-local GUC.
      await transaction.query(
        "SELECT set_config('request.jwt.claim.sub', $1, true)",
        [context.userId]
      );

      const update = await transaction.query<UpdatedDealRow>(
        `UPDATE public.deals AS d
         SET status = $3
         WHERE d.account_id = $1
           AND d.id = $2
           AND EXISTS (
             SELECT 1
             FROM public.pipelines AS p
             WHERE p.id = d.pipeline_id
               AND p.account_id = d.account_id
           )
         RETURNING d.id::text AS id, d.status`,
        [context.accountId, dealId, statusInput]
      );

      if (update.rows.length === 0) throw new AppError('not_found');
      if (update.rows.length !== 1) throw new AppError('conflict');
      const row = update.rows[0];
      if (row.id !== dealId || row.status !== statusInput) {
        throw new AppError('db_error');
      }
    });

    if (!result.ok) throw result.error;
  }

  return { setStatus };
}
