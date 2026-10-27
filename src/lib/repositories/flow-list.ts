import 'server-only';

import type { QueryResultRow } from 'pg';
import type { AccountGuardDependencies } from '../auth/postgres-account-guard';
import { createDefaultPostgresAccountGuards } from '../auth/postgres-account-guard';
import { AppError } from '../db/errors';
import { withTransaction } from '../db/postgres-client';

export type FlowListStatus = 'draft' | 'active' | 'archived';
export type FlowListTriggerType =
  | 'keyword'
  | 'first_inbound_message'
  | 'manual';

export interface FlowListItem {
  id: string;
  name: string;
  description: string | null;
  status: FlowListStatus;
  trigger_type: FlowListTriggerType;
  trigger_config: Record<string, unknown>;
  execution_count: number;
}

interface FlowListRow extends QueryResultRow {
  id: string | null;
  name: string | null;
  description: string | null;
  status: string | null;
  trigger_type: string | null;
  trigger_config: unknown;
  execution_count: number | null;
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

function flowStatus(value: unknown): FlowListStatus {
  if (value === 'draft' || value === 'active' || value === 'archived') {
    return value;
  }
  throw new AppError('db_error');
}

function flowTriggerType(value: unknown): FlowListTriggerType {
  if (
    value === 'keyword' ||
    value === 'first_inbound_message' ||
    value === 'manual'
  ) {
    return value;
  }
  throw new AppError('db_error');
}

function jsonObject(value: unknown): Record<string, unknown> {
  if (
    typeof value !== 'object' ||
    value === null ||
    Array.isArray(value) ||
    (Object.getPrototypeOf(value) !== Object.prototype &&
      Object.getPrototypeOf(value) !== null)
  ) {
    throw new AppError('db_error');
  }
  return value as Record<string, unknown>;
}

function nonNegativeInteger(value: unknown): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) {
    throw new AppError('db_error');
  }
  return value;
}

function toFlowListItem(row: FlowListRow): FlowListItem {
  return {
    id: uuidString(row.id),
    name: requiredString(row.name),
    description: optionalString(row.description),
    status: flowStatus(row.status),
    trigger_type: flowTriggerType(row.trigger_type),
    trigger_config: jsonObject(row.trigger_config),
    execution_count: nonNegativeInteger(row.execution_count),
  };
}

/** List the fields consumed by the flow screen within the verified account. */
export function createPostgresFlowListRepository(
  getVerifiedSession: AccountGuardDependencies['getVerifiedSession']
): { listForCurrentAccount: () => Promise<FlowListItem[]> } {
  const guards = createDefaultPostgresAccountGuards(getVerifiedSession);

  async function listForCurrentAccount(): Promise<FlowListItem[]> {
    const context = await guards.requireAccount();

    const result = await withTransaction(async (transaction) => {
      // Existing RLS policies resolve auth.uid() from this transaction-local GUC.
      await transaction.query(
        "SELECT set_config('request.jwt.claim.sub', $1, true)",
        [context.userId]
      );

      const query = await transaction.query<FlowListRow>(
        `SELECT
           f.id::text AS id,
           f.name,
           f.description,
           f.status,
           f.trigger_type,
           f.trigger_config,
           f.execution_count
         FROM public.flows AS f
         WHERE f.account_id = $1
         ORDER BY f.created_at DESC, f.id DESC`,
        [context.accountId]
      );

      return query.rows.map(toFlowListItem);
    });

    if (!result.ok) throw result.error;
    return result.data;
  }

  return { listForCurrentAccount };
}
