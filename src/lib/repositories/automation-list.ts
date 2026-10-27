import 'server-only';

import type { QueryResultRow } from 'pg';
import type { AccountGuardDependencies } from '../auth/postgres-account-guard';
import { createDefaultPostgresAccountGuards } from '../auth/postgres-account-guard';
import { AppError } from '../db/errors';
import { withTransaction } from '../db/postgres-client';

export interface AutomationListItem {
  id: string;
  name: string;
  description: string | null;
  trigger_type: string;
  is_active: boolean;
  execution_count: number;
  last_executed_at: string | null;
}

interface AutomationListRow extends QueryResultRow {
  id: string | null;
  name: string | null;
  description: string | null;
  trigger_type: string | null;
  is_active: boolean | null;
  execution_count: number | string | null;
  last_executed_at: string | null;
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

function optionalString(value: unknown): string | null {
  if (value === null) return null;
  return requiredString(value);
}

function booleanValue(value: unknown): boolean {
  if (typeof value !== 'boolean') throw new AppError('db_error');
  return value;
}

function nonNegativeInteger(value: unknown): number {
  const count = typeof value === 'string' ? Number(value) : value;
  if (typeof count !== 'number' || !Number.isSafeInteger(count) || count < 0) {
    throw new AppError('db_error');
  }
  return count;
}

function optionalTimestamp(value: unknown): string | null {
  if (value === null) return null;
  if (typeof value !== 'string') throw new AppError('db_error');
  const date = new Date(value);
  if (!Number.isFinite(date.getTime()) || date.toISOString() !== value) {
    throw new AppError('db_error');
  }
  return value;
}

function toAutomationListItem(row: AutomationListRow): AutomationListItem {
  return {
    id: uuidString(row.id),
    name: requiredString(row.name),
    description: optionalString(row.description),
    trigger_type: requiredString(row.trigger_type),
    is_active: booleanValue(row.is_active),
    execution_count: nonNegativeInteger(row.execution_count),
    last_executed_at: optionalTimestamp(row.last_executed_at),
  };
}

/** List safe automation-card fields visible to the verified account. */
export function createPostgresAutomationListRepository(
  getVerifiedSession: AccountGuardDependencies['getVerifiedSession']
): { listForCurrentAccount: () => Promise<AutomationListItem[]> } {
  const guards = createDefaultPostgresAccountGuards(getVerifiedSession);

  async function listForCurrentAccount(): Promise<AutomationListItem[]> {
    const context = await guards.requireAccount();

    const result = await withTransaction(async (transaction) => {
      // Existing RLS policies resolve auth.uid() from this transaction-local GUC.
      await transaction.query(
        "SELECT set_config('request.jwt.claim.sub', $1, true)",
        [context.userId]
      );

      const query = await transaction.query<AutomationListRow>(
        `SELECT
           a.id::text AS id,
           a.name,
           a.description,
           a.trigger_type,
           a.is_active,
           a.execution_count,
           CASE
             WHEN a.last_executed_at IS NULL THEN NULL
             ELSE to_char(
               a.last_executed_at AT TIME ZONE 'UTC',
               'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'
             )
           END AS last_executed_at
         FROM public.automations AS a
         WHERE a.account_id = $1
         ORDER BY a.created_at DESC, a.id DESC`,
        [context.accountId]
      );

      return query.rows.map(toAutomationListItem);
    });

    if (!result.ok) throw result.error;
    return result.data;
  }

  return { listForCurrentAccount };
}
