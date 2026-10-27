import 'server-only';

import type { QueryResultRow } from 'pg';
import type { AccountGuardDependencies } from '../auth/postgres-account-guard';
import { createDefaultPostgresAccountGuards } from '../auth/postgres-account-guard';
import { AppError } from '../db/errors';
import { withTransaction } from '../db/postgres-client';
import { isAccountRole } from '../auth/roles';

interface TargetRow extends QueryResultRow {
  role: string;
}

interface RemovedAccountRow extends QueryResultRow {
  account_id: string;
}

function isUuid(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
      value
    )
  );
}

function normalizeUuid(value: string): string {
  return value.toLowerCase();
}

/**
 * PostgreSQL member removal through migration 018's SECURITY DEFINER RPC.
 * Account creation and profile reassignment remain owned by that RPC.
 */
export function createPostgresAccountMemberRemovalRepository(
  getVerifiedSession: AccountGuardDependencies['getVerifiedSession']
): {
  removeMember: (targetUserId: string) => Promise<string>;
} {
  const guards = createDefaultPostgresAccountGuards(getVerifiedSession);

  async function removeMember(targetUserId: string): Promise<string> {
    const context = await guards.requireRole('admin');

    if (
      !isUuid(targetUserId) ||
      normalizeUuid(targetUserId) === normalizeUuid(context.userId)
    ) {
      throw new AppError('forbidden');
    }

    const result = await withTransaction(async (transaction) => {
      // Existing migration policies resolve auth.uid() from this transaction-
      // local setting; the pool must not retain the verified identity.
      await transaction.query(
        "SELECT set_config('request.jwt.claim.sub', $1, true)",
        [context.userId]
      );

      const targets = await transaction.query<TargetRow>(
        `SELECT target.account_role::text AS role
         FROM public.profiles AS target
         WHERE target.user_id = $1
           AND target.account_id = $2`,
        [targetUserId, context.accountId]
      );
      if (targets.rows.length === 0) throw new AppError('not_found');
      if (targets.rows.length !== 1) throw new AppError('conflict');

      const targetRole = targets.rows[0].role;
      if (!isAccountRole(targetRole)) throw new AppError('db_error');
      if (targetRole === 'owner') throw new AppError('forbidden');

      const removed = await transaction.query<RemovedAccountRow>(
        'SELECT public.remove_account_member($1::uuid)::text AS account_id',
        [targetUserId]
      );
      if (removed.rows.length !== 1) {
        throw new AppError(removed.rows.length > 1 ? 'conflict' : 'db_error');
      }

      const accountId = removed.rows[0].account_id;
      if (!isUuid(accountId)) throw new AppError('db_error');
      return normalizeUuid(accountId);
    });

    if (!result.ok) throw result.error;
    return result.data;
  }

  return { removeMember };
}
