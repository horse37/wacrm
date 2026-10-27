import 'server-only';

import type { QueryResultRow } from 'pg';
import type { Tag } from '../../types';
import type { AccountGuardDependencies } from '../auth/postgres-account-guard';
import { createDefaultPostgresAccountGuards } from '../auth/postgres-account-guard';
import { AppError } from '../db/errors';
import { withTransaction } from '../db/postgres-client';

interface TagListRow extends QueryResultRow {
  id: string | null;
  user_id: string | null;
  account_id: string | null;
  name: string | null;
  color: string | null;
  created_at: Date | string | null;
}

function uuidString(value: unknown): string {
  if (
    typeof value !== 'string' ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
      value
    )
  ) {
    throw new AppError('db_error');
  }
  return value.toLowerCase();
}

function requiredString(value: unknown): string {
  if (typeof value !== 'string') throw new AppError('db_error');
  return value;
}

function timestampString(value: Date | string | null): string {
  const date = value instanceof Date ? value : new Date(value ?? Number.NaN);
  if (!Number.isFinite(date.getTime())) throw new AppError('db_error');
  return date.toISOString();
}

function toTag(row: TagListRow, accountId: string): Tag {
  const rowAccountId = uuidString(row.account_id);
  if (rowAccountId !== accountId.toLowerCase()) throw new AppError('db_error');

  return {
    id: uuidString(row.id),
    user_id: uuidString(row.user_id),
    name: requiredString(row.name),
    color: requiredString(row.color),
    created_at: timestampString(row.created_at),
  };
}

/** Read tags that belong to the verified account. */
export function createPostgresTagListRepository(
  getVerifiedSession: AccountGuardDependencies['getVerifiedSession']
): { list: () => Promise<Tag[]> } {
  const guards = createDefaultPostgresAccountGuards(getVerifiedSession);

  async function list(): Promise<Tag[]> {
    const context = await guards.requireAccount();

    const result = await withTransaction(async (transaction) => {
      // Existing RLS policies resolve auth.uid() from this transaction-local GUC.
      await transaction.query(
        "SELECT set_config('request.jwt.claim.sub', $1, true)",
        [context.userId]
      );

      const query = await transaction.query<TagListRow>(
        `SELECT
           t.id::text AS id,
           t.user_id::text AS user_id,
           t.account_id::text AS account_id,
           t.name,
           t.color,
           t.created_at
         FROM public.tags AS t
         WHERE t.account_id = $1
         ORDER BY t.created_at ASC NULLS LAST, t.id ASC`,
        [context.accountId]
      );

      return query.rows.map((row) => toTag(row, context.accountId));
    });

    if (!result.ok) throw result.error;
    return result.data;
  }

  return { list };
}
