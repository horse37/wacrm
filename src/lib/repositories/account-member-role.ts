import 'server-only';

import type { QueryResultRow } from 'pg';
import type { AccountGuardDependencies } from '../auth/postgres-account-guard';
import { createDefaultPostgresAccountGuards } from '../auth/postgres-account-guard';
import { AppError } from '../db/errors';
import { withTransaction } from '../db/postgres-client';
import { isAccountRole, type AccountRole } from '../auth/roles';

export type EditableAccountRole = Exclude<AccountRole, 'owner'>;

interface RoleRow extends QueryResultRow {
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
 * PostgreSQL member-role changes through the existing SECURITY DEFINER RPC.
 * The verified-session guard scopes the caller; the RPC remains the final
 * authorization boundary for this high-impact account operation.
 */
export function createPostgresAccountMemberRoleRepository(
  getVerifiedSession: AccountGuardDependencies['getVerifiedSession']
): {
  setRole: (targetUserId: string, role: EditableAccountRole) => Promise<void>;
} {
  const guards = createDefaultPostgresAccountGuards(getVerifiedSession);

  async function setRole(
    targetUserId: string,
    role: EditableAccountRole
  ): Promise<void> {
    const context = await guards.requireRole('admin');
    const requestedRole: unknown = role;

    if (
      !isAccountRole(requestedRole) ||
      requestedRole === 'owner' ||
      !isUuid(targetUserId) ||
      normalizeUuid(targetUserId) === normalizeUuid(context.userId)
    ) {
      throw new AppError('forbidden');
    }
    const editableRole = requestedRole;

    const result = await withTransaction(async (transaction) => {
      // Existing RPC and migration policies resolve auth.uid() from this GUC.
      // Keep it transaction-local to prevent identity leaking through the pool.
      await transaction.query(
        "SELECT set_config('request.jwt.claim.sub', $1, true)",
        [context.userId]
      );

      const targets = await transaction.query<RoleRow>(
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

      await transaction.query(
        'SELECT public.set_member_role($1::uuid, $2::public.account_role_enum)',
        [targetUserId, editableRole]
      );
    });

    if (!result.ok) throw result.error;
  }

  return { setRole };
}
