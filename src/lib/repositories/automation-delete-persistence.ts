import 'server-only';

import type { QueryResultRow } from 'pg';
import type { AccountGuardDependencies } from '../auth/postgres-account-guard';
import { createDefaultPostgresAccountGuards } from '../auth/postgres-account-guard';
import { AppError } from '../db/errors';
import { withTransaction } from '../db/postgres-client';

interface DeletedAutomationRow extends QueryResultRow {
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

/** Delete one automation only when the verified agent owns it in the verified account. */
export function createPostgresAutomationDeletePersistenceRepository(
  getVerifiedSession: AccountGuardDependencies['getVerifiedSession']
): {
  deleteOwnedAutomation: (automationId: string) => Promise<void>;
} {
  const guards = createDefaultPostgresAccountGuards(getVerifiedSession);

  async function deleteOwnedAutomation(
    automationIdInput: string
  ): Promise<void> {
    const context = await guards.requireRole('agent');
    const automationId = requestedUuid(automationIdInput);

    const result = await withTransaction(async (transaction) => {
      // Existing RLS policies resolve auth.uid() from this transaction-local GUC.
      await transaction.query(
        "SELECT set_config('request.jwt.claim.sub', $1, true)",
        [context.userId]
      );

      const deletion = await transaction.query<DeletedAutomationRow>(
        `DELETE FROM public.automations AS automation
         WHERE automation.id = $1
           AND automation.user_id = $2
           AND automation.account_id = $3
           AND EXISTS (
             SELECT 1
             FROM public.profiles AS profile
             WHERE profile.user_id = automation.user_id
               AND profile.account_id = automation.account_id
           )
         RETURNING automation.id::text AS id`,
        [automationId, context.userId, context.accountId]
      );

      if (deletion.rows.length === 0) throw new AppError('not_found');
      if (deletion.rows.length !== 1) throw new AppError('conflict');
      if (returnedUuid(deletion.rows[0].id) !== automationId) {
        throw new AppError('db_error');
      }
    });

    if (!result.ok) throw result.error;
  }

  return { deleteOwnedAutomation };
}
