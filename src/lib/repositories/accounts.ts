import 'server-only';

import type { QueryResultRow } from 'pg';
import { AppError } from '../db/errors';
import { withTransaction } from '../db/postgres-client';
import type { AccountGuardDependencies } from '../auth/postgres-account-guard';
import { createDefaultPostgresAccountGuards } from '../auth/postgres-account-guard';

interface UpdatedAccountRow extends QueryResultRow {
  id: string;
  name: string;
}

/**
 * PostgreSQL account operations scoped to the verified caller.
 * The caller must validate and normalize account names before invoking rename.
 */
export function createPostgresAccountRepository(
  getVerifiedSession: AccountGuardDependencies['getVerifiedSession']
): { rename: (name: string) => Promise<{ id: string; name: string }> } {
  const guards = createDefaultPostgresAccountGuards(getVerifiedSession);

  async function rename(name: string): Promise<{ id: string; name: string }> {
    const context = await guards.requireRole('admin');
    const result = await withTransaction(async (transaction) => {
      // Existing migration RLS policies resolve auth.uid() from this GUC.
      // Keep it transaction-local so pooled identity cannot leak to another call.
      await transaction.query(
        "SELECT set_config('request.jwt.claim.sub', $1, true)",
        [context.userId]
      );

      const update = await transaction.query<UpdatedAccountRow>(
        `UPDATE public.accounts AS a
         SET name = $1
         WHERE a.id = $2
         RETURNING a.id::text AS id, a.name`,
        [name, context.accountId]
      );

      if (update.rows.length === 0) throw new AppError('not_found');
      if (update.rows.length !== 1) throw new AppError('conflict');
      return update.rows[0];
    });

    if (!result.ok) throw result.error;
    return result.data;
  }

  return { rename };
}
