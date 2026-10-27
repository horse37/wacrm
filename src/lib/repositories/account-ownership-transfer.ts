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

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
    value
  );
}

function normalizeUuid(value: string): string {
  return value.toLowerCase();
}

/**
 * Ownership transfer through migration 018's SECURITY DEFINER RPC.
 * The RPC remains responsible for atomically updating both roles and the
 * account owner pointer.
 */
export function createPostgresAccountOwnershipTransferRepository(
  getVerifiedSession: AccountGuardDependencies['getVerifiedSession']
): {
  transferTo: (targetUserId: string) => Promise<void>;
} {
  const guards = createDefaultPostgresAccountGuards(getVerifiedSession);

  async function transferTo(targetUserId: string): Promise<void> {
    const context = await guards.requireRole('owner');

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
      if (!isAccountRole(targets.rows[0].role)) throw new AppError('db_error');

      const transferred = await transaction.query(
        'SELECT public.transfer_account_ownership($1::uuid)',
        [targetUserId]
      );
      if (transferred.rows.length !== 1) {
        throw new AppError(
          transferred.rows.length > 1 ? 'conflict' : 'db_error'
        );
      }
    });

    if (!result.ok) throw result.error;
  }

  return { transferTo };
}
