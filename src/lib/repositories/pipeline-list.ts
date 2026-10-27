import 'server-only';

import type { QueryResultRow } from 'pg';
import type { Pipeline } from '../../types';
import type { AccountGuardDependencies } from '../auth/postgres-account-guard';
import { createDefaultPostgresAccountGuards } from '../auth/postgres-account-guard';
import { AppError } from '../db/errors';
import { withTransaction } from '../db/postgres-client';

interface PipelineListRow extends QueryResultRow {
  id: string | null;
  user_id: string | null;
  account_id: string | null;
  name: string | null;
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

function toPipeline(row: PipelineListRow, accountId: string): Pipeline {
  const id = uuidString(row.id);
  const userId = uuidString(row.user_id);
  const rowAccountId = uuidString(row.account_id);
  if (rowAccountId !== accountId.toLowerCase()) throw new AppError('db_error');

  return {
    id,
    user_id: userId,
    name: requiredString(row.name),
    created_at:
      row.created_at === null ? null : timestampString(row.created_at),
  };
}

/** List pipelines in the verified account in stable creation order. */
export function createPostgresPipelineListRepository(
  getVerifiedSession: AccountGuardDependencies['getVerifiedSession']
): { listForAccount: () => Promise<Pipeline[]> } {
  const guards = createDefaultPostgresAccountGuards(getVerifiedSession);

  async function listForAccount(): Promise<Pipeline[]> {
    const context = await guards.requireAccount();

    const result = await withTransaction(async (transaction) => {
      // Existing RLS policies resolve auth.uid() from this transaction-local GUC.
      await transaction.query(
        "SELECT set_config('request.jwt.claim.sub', $1, true)",
        [context.userId]
      );

      const query = await transaction.query<PipelineListRow>(
        `SELECT
           p.id::text AS id,
           p.user_id::text AS user_id,
           p.account_id::text AS account_id,
           p.name,
           p.created_at
         FROM public.pipelines AS p
         WHERE p.account_id = $1
         ORDER BY p.created_at ASC NULLS LAST, p.id ASC`,
        [context.accountId]
      );

      return query.rows.map((row) => toPipeline(row, context.accountId));
    });

    if (!result.ok) throw result.error;
    return result.data;
  }

  return { listForAccount };
}
