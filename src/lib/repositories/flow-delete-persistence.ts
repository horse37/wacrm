import 'server-only';

import type { QueryResultRow } from 'pg';
import type { AccountGuardDependencies } from '../auth/postgres-account-guard';
import { createDefaultPostgresAccountGuards } from '../auth/postgres-account-guard';
import { AppError } from '../db/errors';
import { withTransaction } from '../db/postgres-client';

interface DeletedFlowRow extends QueryResultRow {
  id: unknown;
}

const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function requestedUuid(value: unknown): string {
  if (typeof value !== 'string' || !uuidPattern.test(value)) {
    throw new AppError('bad_request');
  }
  return value.toLowerCase();
}

function returnedUuid(value: unknown): string {
  if (typeof value !== 'string' || !uuidPattern.test(value)) {
    throw new AppError('db_error');
  }
  return value.toLowerCase();
}

/** Delete one flow only when the verified agent owns it in the verified account. */
export function createPostgresFlowDeletePersistenceRepository(
  getVerifiedSession: AccountGuardDependencies['getVerifiedSession']
): {
  deleteOwnedFlow: (flowId: string) => Promise<void>;
} {
  const guards = createDefaultPostgresAccountGuards(getVerifiedSession);

  async function deleteOwnedFlow(flowIdInput: string): Promise<void> {
    const context = await guards.requireRole('agent');
    const flowId = requestedUuid(flowIdInput);

    const result = await withTransaction(async (transaction) => {
      // Existing RLS policies resolve auth.uid() from this transaction-local GUC.
      await transaction.query(
        "SELECT set_config('request.jwt.claim.sub', $1, true)",
        [context.userId]
      );

      const deletion = await transaction.query<DeletedFlowRow>(
        `DELETE FROM public.flows AS flow
         WHERE flow.id = $1
           AND flow.user_id = $2
           AND flow.account_id = $3
         RETURNING flow.id::text AS id`,
        [flowId, context.userId, context.accountId]
      );

      if (deletion.rows.length === 0) throw new AppError('not_found');
      if (deletion.rows.length !== 1) throw new AppError('conflict');
      if (returnedUuid(deletion.rows[0].id) !== flowId) {
        throw new AppError('db_error');
      }
    });

    if (!result.ok) throw result.error;
  }

  return { deleteOwnedFlow };
}
