import 'server-only';

import type { QueryResultRow } from 'pg';
import type { AccountGuardDependencies } from '../auth/postgres-account-guard';
import { createDefaultPostgresAccountGuards } from '../auth/postgres-account-guard';
import { AppError } from '../db/errors';
import { withTransaction } from '../db/postgres-client';
import { isAccountRole, type AccountRole } from '../auth/roles';

export type InvitationRole = Exclude<AccountRole, 'owner'>;

export interface CreateAccountInvitationInput {
  role: InvitationRole;
  tokenHash: string;
  label: string | null;
  expiresAt: Date | string;
}

export interface CreatedAccountInvitation {
  id: string;
  role: InvitationRole;
  label: string | null;
  expires_at: string;
  created_at: string;
}

export interface AccountInvitationSummary {
  id: string;
  role: AccountRole;
  label: string | null;
  created_by_user_id: string | null;
  created_at: string;
  expires_at: string;
  accepted_at: string | null;
  accepted_by_user_id: string | null;
}

interface AccountInvitationRow extends QueryResultRow {
  id: string;
  role: string;
  label: string | null;
  created_by_user_id: string | null;
  created_at: Date | string;
  expires_at: Date | string;
  accepted_at: Date | string | null;
  accepted_by_user_id: string | null;
}

interface CreatedAccountInvitationRow extends QueryResultRow {
  id: string;
  role: string;
  label: string | null;
  expires_at: Date | string;
  created_at: Date | string;
}

function toIsoTimestamp(value: Date | string | null): string | null {
  if (value === null) return null;
  return value instanceof Date ? value.toISOString() : value;
}

/**
 * PostgreSQL-backed read of outstanding invites in the caller's account.
 * Stored token hashes are intentionally never selected or returned.
 */
export function createPostgresAccountInvitationsRepository(
  getVerifiedSession: AccountGuardDependencies['getVerifiedSession']
): {
  listOutstanding: () => Promise<AccountInvitationSummary[]>;
  create: (
    input: CreateAccountInvitationInput
  ) => Promise<CreatedAccountInvitation>;
  revoke: (invitationId: string) => Promise<boolean>;
} {
  const guards = createDefaultPostgresAccountGuards(getVerifiedSession);

  async function listOutstanding(): Promise<AccountInvitationSummary[]> {
    const context = await guards.requireRole('admin');
    const result = await withTransaction(async (transaction) => {
      // Existing migration RLS policies resolve auth.uid() from this GUC.
      // Keep it transaction-local so pooled identity cannot leak to another call.
      await transaction.query(
        "SELECT set_config('request.jwt.claim.sub', $1, true)",
        [context.userId]
      );

      const invitations = await transaction.query<AccountInvitationRow>(
        `SELECT
           invitation.id::text AS id,
           invitation.role::text AS role,
           invitation.label,
           invitation.created_by_user_id::text AS created_by_user_id,
           invitation.created_at,
           invitation.expires_at,
           invitation.accepted_at,
           invitation.accepted_by_user_id::text AS accepted_by_user_id
         FROM public.account_invitations AS invitation
         WHERE invitation.account_id = $1
           AND invitation.accepted_at IS NULL
           AND invitation.expires_at > CURRENT_TIMESTAMP
         ORDER BY invitation.created_at DESC, invitation.id DESC`,
        [context.accountId]
      );

      return invitations.rows;
    });

    if (!result.ok) throw result.error;

    return result.data.flatMap((row) => {
      if (!isAccountRole(row.role)) return [];
      return [
        {
          id: row.id,
          role: row.role,
          label: row.label,
          created_by_user_id: row.created_by_user_id,
          created_at: toIsoTimestamp(row.created_at) ?? '',
          expires_at: toIsoTimestamp(row.expires_at) ?? '',
          accepted_at: toIsoTimestamp(row.accepted_at),
          accepted_by_user_id: row.accepted_by_user_id,
        },
      ];
    });
  }

  async function create(
    input: CreateAccountInvitationInput
  ): Promise<CreatedAccountInvitation> {
    const context = await guards.requireRole('admin');
    const role: unknown = input.role;
    if (
      !isAccountRole(role) ||
      role === 'owner' ||
      !/^[a-f0-9]{64}$/i.test(input.tokenHash)
    ) {
      throw new AppError('forbidden');
    }

    const result = await withTransaction(async (transaction) => {
      // Existing migration RLS policies resolve auth.uid() from this GUC.
      // Keep it transaction-local so pooled identity cannot leak to another call.
      await transaction.query(
        "SELECT set_config('request.jwt.claim.sub', $1, true)",
        [context.userId]
      );

      const inserted = await transaction.query<CreatedAccountInvitationRow>(
        `INSERT INTO public.account_invitations (
           account_id,
           token_hash,
           role,
           created_by_user_id,
           label,
           expires_at
         )
         VALUES ($1, $2, $3::public.account_role_enum, $4, $5, $6)
         RETURNING
           id::text AS id,
           role::text AS role,
           label,
           expires_at,
           created_at`,
        [
          context.accountId,
          input.tokenHash,
          role,
          context.userId,
          input.label,
          input.expiresAt,
        ]
      );

      if (inserted.rows.length !== 1) throw new AppError('conflict');
      return inserted.rows[0];
    });

    if (!result.ok) throw result.error;

    const row = result.data;
    if (!isAccountRole(row.role) || row.role === 'owner') {
      throw new AppError('db_error');
    }

    return {
      id: row.id,
      role: row.role,
      label: row.label,
      expires_at: toIsoTimestamp(row.expires_at) ?? '',
      created_at: toIsoTimestamp(row.created_at) ?? '',
    };
  }

  async function revoke(invitationId: string): Promise<boolean> {
    const context = await guards.requireRole('admin');
    const result = await withTransaction(async (transaction) => {
      // Existing migration RLS policies resolve auth.uid() from this GUC.
      // Keep it transaction-local so pooled identity cannot leak to another call.
      await transaction.query(
        "SELECT set_config('request.jwt.claim.sub', $1, true)",
        [context.userId]
      );

      const deleted = await transaction.query<{ id: string }>(
        `DELETE FROM public.account_invitations AS invitation
         WHERE invitation.id = $1
           AND invitation.account_id = $2
         RETURNING invitation.id::text AS id`,
        [invitationId, context.accountId]
      );

      if (deleted.rows.length > 1) throw new AppError('conflict');
      return deleted.rows.length === 1;
    });

    if (!result.ok) throw result.error;
    return result.data;
  }

  return { listOutstanding, create, revoke };
}
