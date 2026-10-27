import 'server-only';

import type { QueryResultRow } from 'pg';
import type { BroadcastStatus } from '../../types';
import type { AccountGuardDependencies } from '../auth/postgres-account-guard';
import { createDefaultPostgresAccountGuards } from '../auth/postgres-account-guard';
import { AppError } from '../db/errors';
import { withTransaction } from '../db/postgres-client';

export interface BroadcastListItem {
  id: string;
  name: string;
  template_name: string;
  status: BroadcastStatus;
  total_recipients: number;
  delivered_count: number;
  read_count: number;
  created_at: string;
}

interface BroadcastListRow extends QueryResultRow {
  id: string | null;
  name: string | null;
  template_name: string | null;
  status: string | null;
  total_recipients: number | string | null;
  delivered_count: number | string | null;
  read_count: number | string | null;
  created_at: string | null;
}

const broadcastStatuses = new Set<BroadcastStatus>([
  'draft',
  'scheduled',
  'sending',
  'sent',
  'failed',
]);

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

function broadcastStatus(value: unknown): BroadcastStatus {
  if (
    typeof value !== 'string' ||
    !broadcastStatuses.has(value as BroadcastStatus)
  ) {
    throw new AppError('db_error');
  }
  return value as BroadcastStatus;
}

function nonNegativeInteger(value: unknown): number {
  const count = typeof value === 'string' ? Number(value) : value;
  if (typeof count !== 'number' || !Number.isSafeInteger(count) || count < 0) {
    throw new AppError('db_error');
  }
  return count;
}

function timestampString(value: unknown): string {
  if (typeof value !== 'string') throw new AppError('db_error');
  const date = new Date(value);
  if (!Number.isFinite(date.getTime()) || date.toISOString() !== value) {
    throw new AppError('db_error');
  }
  return value;
}

function toBroadcastListItem(row: BroadcastListRow): BroadcastListItem {
  return {
    id: uuidString(row.id),
    name: requiredString(row.name),
    template_name: requiredString(row.template_name),
    status: broadcastStatus(row.status),
    total_recipients: nonNegativeInteger(row.total_recipients),
    delivered_count: nonNegativeInteger(row.delivered_count),
    read_count: nonNegativeInteger(row.read_count),
    created_at: timestampString(row.created_at),
  };
}

/** List validated broadcast-card fields visible to the verified account. */
export function createPostgresBroadcastListRepository(
  getVerifiedSession: AccountGuardDependencies['getVerifiedSession']
): { listForCurrentAccount: () => Promise<BroadcastListItem[]> } {
  const guards = createDefaultPostgresAccountGuards(getVerifiedSession);

  async function listForCurrentAccount(): Promise<BroadcastListItem[]> {
    const context = await guards.requireAccount();

    const result = await withTransaction(async (transaction) => {
      // Existing RLS policies resolve auth.uid() from this transaction-local GUC.
      await transaction.query(
        "SELECT set_config('request.jwt.claim.sub', $1, true)",
        [context.userId]
      );

      const query = await transaction.query<BroadcastListRow>(
        `SELECT
           b.id::text AS id,
           b.name,
           b.template_name,
           b.status,
           b.total_recipients,
           b.delivered_count,
           b.read_count,
           CASE
             WHEN b.created_at IS NULL THEN NULL
             ELSE to_char(
               b.created_at AT TIME ZONE 'UTC',
               'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'
             )
           END AS created_at
         FROM public.broadcasts AS b
         WHERE b.account_id = $1
         ORDER BY b.created_at DESC, b.id DESC`,
        [context.accountId]
      );

      return query.rows.map(toBroadcastListItem);
    });

    if (!result.ok) throw result.error;
    return result.data;
  }

  return { listForCurrentAccount };
}
