import 'server-only';

import type { QueryResultRow } from 'pg';
import type { AccountGuardDependencies } from '../auth/postgres-account-guard';
import { createDefaultPostgresAccountGuards } from '../auth/postgres-account-guard';
import { AppError } from '../db/errors';
import { withTransaction } from '../db/postgres-client';

interface RedeemedInvitationRow extends QueryResultRow {
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

/** Redeem a SHA-256 invite digest through migration 019's existing RPC. */
export function createPostgresInvitationRedemptionRepository(
  getVerifiedSession: AccountGuardDependencies['getVerifiedSession']
): {
  redeemByTokenHash: (tokenHash: string) => Promise<string>;
} {
  const guards = createDefaultPostgresAccountGuards(getVerifiedSession);

  async function redeemByTokenHash(tokenHash: string): Promise<string> {
    const context = await guards.requireAccount();
    if (!/^[a-f0-9]{64}$/i.test(tokenHash)) {
      throw new AppError('not_found');
    }

    const result = await withTransaction(async (transaction) => {
      await transaction.query(
        "SELECT set_config('request.jwt.claim.sub', $1, true)",
        [context.userId]
      );

      const redeemed = await transaction.query<RedeemedInvitationRow>(
        'SELECT public.redeem_invitation($1::text) AS account_id',
        [tokenHash.toLowerCase()]
      );
      if (redeemed.rows.length !== 1) {
        throw new AppError(redeemed.rows.length > 1 ? 'conflict' : 'db_error');
      }

      const accountId = redeemed.rows[0].account_id;
      if (!isUuid(accountId)) throw new AppError('db_error');
      return accountId.toLowerCase();
    });

    if (!result.ok) {
      // Migration 019's intentional PL/pgSQL RAISE uses 42501. ACL denials
      // also use 42501, but must remain database errors and be logged.
      if (
        result.error.sqlState === '42501' &&
        result.error.routine === 'exec_stmt_raise'
      ) {
        throw new AppError('unauthorized');
      }
      throw result.error;
    }
    return result.data;
  }

  return { redeemByTokenHash };
}
