import 'server-only';

import type { QueryResultRow } from 'pg';
import type { AccountMember } from '../../types';
import { withTransaction } from '../db/postgres-client';
import type { AccountGuardDependencies } from '../auth/postgres-account-guard';
import { createDefaultPostgresAccountGuards } from '../auth/postgres-account-guard';
import { canManageMembers, isAccountRole } from '../auth/roles';

interface AccountMemberRow extends QueryResultRow {
  user_id: string;
  full_name: string | null;
  email: string | null;
  avatar_url: string | null;
  role: string;
  caller_role: string;
  joined_at: Date | string | null;
}

/**
 * PostgreSQL-backed member listing for the caller's verified account.
 * The session resolver must validate a server-side session; caller-provided
 * identity or account IDs are never accepted by this repository.
 */
export function createPostgresAccountMembersRepository(
  getVerifiedSession: AccountGuardDependencies['getVerifiedSession']
): { list: () => Promise<AccountMember[]> } {
  const guards = createDefaultPostgresAccountGuards(getVerifiedSession);

  async function list(): Promise<AccountMember[]> {
    const context = await guards.requireAccount();
    const result = await withTransaction(async (transaction) => {
      // Existing migration RLS policies resolve auth.uid() from this GUC.
      // Keep it transaction-local so pooled identity cannot leak to another call.
      await transaction.query(
        "SELECT set_config('request.jwt.claim.sub', $1, true)",
        [context.userId]
      );

      const members = await transaction.query<AccountMemberRow>(
        `WITH caller AS (
           SELECT profile.account_role::text AS role
           FROM public.profiles AS profile
           WHERE profile.user_id = $2
             AND profile.account_id = $1
           LIMIT 1
         )
         SELECT
           p.user_id::text AS user_id,
           p.full_name,
           p.email,
           p.avatar_url,
           p.account_role::text AS role,
           caller.role AS caller_role,
           p.created_at AS joined_at
         FROM public.profiles AS p
         CROSS JOIN caller
         WHERE p.account_id = $1
         ORDER BY p.created_at ASC NULLS LAST, p.user_id ASC`,
        [context.accountId, context.userId]
      );

      return members.rows;
    });

    if (!result.ok) throw result.error;

    const callerRole = result.data[0]?.caller_role;
    const canSeeEmails =
      isAccountRole(callerRole) && canManageMembers(callerRole);
    return result.data.flatMap((row) => {
      if (!isAccountRole(row.role)) return [];

      return [
        {
          user_id: row.user_id,
          full_name: row.full_name ?? '',
          email: canSeeEmails ? row.email : null,
          avatar_url: row.avatar_url,
          role: row.role,
          joined_at:
            row.joined_at instanceof Date
              ? row.joined_at.toISOString()
              : (row.joined_at ?? ''),
        },
      ];
    });
  }

  return { list };
}
