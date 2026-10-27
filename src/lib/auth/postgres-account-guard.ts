import 'server-only';

import type { QueryResultRow } from 'pg';
import { AppError } from '../db/errors';
import type { DbResult } from '../db/errors';
import { withTransaction } from '../db/postgres-client';
import { hasMinRole, isAccountRole, type AccountRole } from './roles';

export interface VerifiedServerSession {
  /** Identity established by a server-side session verifier. */
  userId: string;
}

export interface AccountMembership {
  userId: string;
  accountId: string;
  role: unknown;
  accountName: string;
}

export interface PostgresAccountContext {
  userId: string;
  accountId: string;
  role: AccountRole;
  account: { id: string; name: string };
}

export interface AccountGuardDependencies {
  /** Must verify a server-side session; never derive identity from request fields. */
  getVerifiedSession: () => Promise<VerifiedServerSession | null>;
  findMembership: (
    userId: string
  ) => Promise<DbResult<AccountMembership | null>>;
}

interface AccountMembershipRow extends QueryResultRow {
  userId: string;
  accountId: string;
  role: string;
  accountName: string;
}

/** Load the single account membership assigned to a profile in migration 017. */
async function findPostgresAccountMembershipByUserId(
  userId: string
): Promise<DbResult<AccountMembership | null>> {
  return withTransaction(async (transaction) => {
    // Existing migration policies resolve auth.uid() from this GUC. Setting it
    // transaction-locally preserves RLS and prevents identity leaking via pool.
    await transaction.query(
      "SELECT set_config('request.jwt.claim.sub', $1, true)",
      [userId]
    );

    const result = await transaction.query<AccountMembershipRow>(
      `SELECT
         p.user_id::text AS "userId",
         p.account_id::text AS "accountId",
         p.account_role::text AS role,
         a.name AS "accountName"
       FROM public.profiles AS p
       INNER JOIN public.accounts AS a ON a.id = p.account_id
       WHERE p.user_id = $1
       LIMIT 2`,
      [userId]
    );

    if (result.rows.length > 1) throw new AppError('conflict');
    return result.rows[0] ?? null;
  });
}

/**
 * Bind authorization to a verified user ID and its PostgreSQL membership.
 * Domain repositories must still put this context's account ID in every
 * account-scoped SQL predicate; this guard does not scope unrelated queries.
 */
export function createPostgresAccountGuards(
  dependencies: AccountGuardDependencies
): {
  requireAccount: () => Promise<PostgresAccountContext>;
  requireRole: (minRole: AccountRole) => Promise<PostgresAccountContext>;
} {
  async function requireAccount(): Promise<PostgresAccountContext> {
    const session = await dependencies.getVerifiedSession();
    if (
      !session ||
      typeof session.userId !== 'string' ||
      session.userId.trim().length === 0
    ) {
      throw new AppError('unauthorized');
    }

    const result = await dependencies.findMembership(session.userId);
    if (!result.ok) throw result.error;

    const membership = result.data;
    if (
      !membership ||
      membership.userId !== session.userId ||
      typeof membership.accountId !== 'string' ||
      membership.accountId.trim().length === 0 ||
      typeof membership.accountName !== 'string' ||
      !isAccountRole(membership.role)
    ) {
      throw new AppError('forbidden');
    }

    return {
      userId: session.userId,
      accountId: membership.accountId,
      role: membership.role,
      account: { id: membership.accountId, name: membership.accountName },
    };
  }

  async function requireRole(
    minRole: AccountRole
  ): Promise<PostgresAccountContext> {
    const context = await requireAccount();
    if (!isAccountRole(minRole) || !hasMinRole(context.role, minRole)) {
      throw new AppError('forbidden', undefined, 'insufficient_role');
    }
    return context;
  }

  return { requireAccount, requireRole };
}

/** Default PostgreSQL-backed guard factory for future verified-session wiring. */
export function createDefaultPostgresAccountGuards(
  getVerifiedSession: AccountGuardDependencies['getVerifiedSession']
) {
  return createPostgresAccountGuards({
    getVerifiedSession,
    findMembership: findPostgresAccountMembershipByUserId,
  });
}
