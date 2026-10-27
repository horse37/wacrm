import 'server-only';

import type { QueryResultRow } from 'pg';
import type { AccountGuardDependencies } from '../auth/postgres-account-guard';
import { createDefaultPostgresAccountGuards } from '../auth/postgres-account-guard';
import { AppError } from '../db/errors';
import { withTransaction } from '../db/postgres-client';

interface DeletedDealRow extends QueryResultRow {
  id: string;
}

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

function returnedUuid(value: unknown): string {
  if (
    typeof value !== 'string' ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
      value
    )
  ) {
    throw new AppError('db_error');
  }
  return value.toLowerCase();
}

/** Delete one consistent deal in the verified account. */
export function createPostgresPipelineDealDeleteRepository(
  getVerifiedSession: AccountGuardDependencies['getVerifiedSession']
): {
  deleteDeal: (dealId: string) => Promise<void>;
} {
  const guards = createDefaultPostgresAccountGuards(getVerifiedSession);

  async function deleteDeal(dealIdInput: string): Promise<void> {
    const context = await guards.requireRole('agent');
    const dealId = requestedUuid(dealIdInput);

    const result = await withTransaction(async (transaction) => {
      // Existing RLS policies resolve auth.uid() from this transaction-local GUC.
      await transaction.query(
        "SELECT set_config('request.jwt.claim.sub', $1, true)",
        [context.userId]
      );

      const deletion = await transaction.query<DeletedDealRow>(
        `DELETE FROM public.deals AS d
         WHERE d.account_id = $1
           AND d.id = $2
           AND EXISTS (
             SELECT 1
             FROM public.pipelines AS p
             WHERE p.id = d.pipeline_id
               AND p.account_id = d.account_id
           )
         RETURNING d.id::text AS id`,
        [context.accountId, dealId]
      );

      if (deletion.rows.length === 0) throw new AppError('not_found');
      if (deletion.rows.length !== 1) throw new AppError('conflict');
      if (returnedUuid(deletion.rows[0].id) !== dealId) {
        throw new AppError('db_error');
      }
    });

    if (!result.ok) throw result.error;
  }

  return { deleteDeal };
}
