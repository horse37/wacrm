import 'server-only';

import type { QueryResultRow } from 'pg';
import { AppError } from '../db/errors';
import { withTransaction } from '../db/postgres-client';
import { isAccountRole, type AccountRole } from '../auth/roles';

export type InvitationPreviewResult =
  | {
      ok: true;
      account_name: string;
      role: AccountRole;
      expires_at: string;
    }
  | { ok: false; reason: 'not_found' | 'expired' | 'used' };

interface InvitationPreviewRow extends QueryResultRow {
  preview: unknown;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function parseInvitationPreview(value: unknown): InvitationPreviewResult {
  if (!isRecord(value)) throw new AppError('db_error');

  if (value.ok === false) {
    if (
      value.reason === 'not_found' ||
      value.reason === 'expired' ||
      value.reason === 'used'
    ) {
      return { ok: false, reason: value.reason };
    }
    throw new AppError('db_error');
  }

  if (
    value.ok !== true ||
    typeof value.account_name !== 'string' ||
    !isAccountRole(value.role) ||
    typeof value.expires_at !== 'string' ||
    !Number.isFinite(Date.parse(value.expires_at))
  ) {
    throw new AppError('db_error');
  }

  return {
    ok: true,
    account_name: value.account_name,
    role: value.role,
    expires_at: value.expires_at,
  };
}

/** Read a public invitation preview by the SHA-256 digest stored in PostgreSQL. */
export function createPostgresInvitationPreviewRepository(): {
  peekByTokenHash: (tokenHash: string) => Promise<InvitationPreviewResult>;
} {
  async function peekByTokenHash(
    tokenHash: string
  ): Promise<InvitationPreviewResult> {
    if (!/^[a-f0-9]{64}$/i.test(tokenHash)) {
      return { ok: false, reason: 'not_found' };
    }

    const result = await withTransaction(async (transaction) => {
      const previews = await transaction.query<InvitationPreviewRow>(
        'SELECT public.peek_invitation($1::text) AS preview',
        [tokenHash.toLowerCase()]
      );
      if (previews.rows.length !== 1) {
        throw new AppError(previews.rows.length > 1 ? 'conflict' : 'db_error');
      }
      return parseInvitationPreview(previews.rows[0].preview);
    });

    if (!result.ok) throw result.error;
    return result.data;
  }

  return { peekByTokenHash };
}
