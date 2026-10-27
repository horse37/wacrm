import 'server-only';

import type { QueryResultRow } from 'pg';
import type { AccountGuardDependencies } from '../auth/postgres-account-guard';
import { createDefaultPostgresAccountGuards } from '../auth/postgres-account-guard';
import { AppError } from '../db/errors';
import { withTransaction } from '../db/postgres-client';

export type FlowRunListStatus =
  | 'active'
  | 'completed'
  | 'handed_off'
  | 'timed_out'
  | 'paused_by_agent'
  | 'failed';

export interface FlowRunListContact {
  id: string;
  name: string | null;
  phone: string;
}

export interface FlowRunListItem {
  id: string;
  status: FlowRunListStatus;
  current_node_key: string | null;
  started_at: string;
  last_advanced_at: string;
  ended_at: string | null;
  end_reason: string | null;
  vars: Record<string, unknown>;
  reprompt_count: number;
  contact: FlowRunListContact | null;
}

export interface FlowRunListData {
  flow: { id: string; name: string };
  runs: FlowRunListItem[];
}

interface FlowRunListFlowRow extends QueryResultRow {
  id: string | null;
  name: string | null;
  creator_user_id: string | null;
  account_id: string | null;
}

interface FlowRunListRow extends QueryResultRow {
  id: string | null;
  flow_id: string | null;
  account_id: string | null;
  user_id: string | null;
  status: string | null;
  current_node_key: string | null;
  started_at: unknown;
  last_advanced_at: unknown;
  ended_at: unknown;
  end_reason: string | null;
  vars: unknown;
  reprompt_count: number | null;
  contact_id: string | null;
  contact_name: string | null;
  contact_phone: string | null;
}

const RUN_LIMIT = 50;

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

function requestedUuid(value: unknown): string {
  try {
    return uuidString(value);
  } catch {
    throw new AppError('bad_request');
  }
}

function requiredString(value: unknown): string {
  if (typeof value !== 'string') throw new AppError('db_error');
  return value;
}

function optionalString(value: unknown): string | null {
  if (value === null) return null;
  return requiredString(value);
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

function flowRunStatus(value: unknown): FlowRunListStatus {
  if (
    value === 'active' ||
    value === 'completed' ||
    value === 'handed_off' ||
    value === 'timed_out' ||
    value === 'paused_by_agent' ||
    value === 'failed'
  ) {
    return value;
  }
  throw new AppError('db_error');
}

function timestampString(value: unknown): string {
  const timestamp =
    value instanceof Date
      ? value
      : typeof value === 'string'
        ? new Date(value)
        : null;
  if (!timestamp || !Number.isFinite(timestamp.getTime())) {
    throw new AppError('db_error');
  }
  return timestamp.toISOString();
}

function optionalTimestampString(value: unknown): string | null {
  if (value === null) return null;
  return timestampString(value);
}

function nonNegativeInteger(value: unknown): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) {
    throw new AppError('db_error');
  }
  return value;
}

function toFlowRunListItem(
  row: FlowRunListRow,
  flowId: string,
  accountId: string,
  flowCreatorId: string
): FlowRunListItem {
  const actualFlowId = uuidString(row.flow_id);
  const actualAccountId = uuidString(row.account_id);
  const actualUserId = uuidString(row.user_id);
  if (
    actualFlowId !== flowId ||
    actualAccountId !== accountId ||
    actualUserId !== flowCreatorId
  ) {
    throw new AppError('db_error');
  }

  let contact: FlowRunListContact | null = null;
  if (row.contact_id === null) {
    if (row.contact_name !== null || row.contact_phone !== null) {
      throw new AppError('db_error');
    }
  } else {
    contact = {
      id: uuidString(row.contact_id),
      name: optionalString(row.contact_name),
      phone: requiredString(row.contact_phone),
    };
  }

  return {
    id: uuidString(row.id),
    status: flowRunStatus(row.status),
    current_node_key: optionalString(row.current_node_key),
    started_at: timestampString(row.started_at),
    last_advanced_at: timestampString(row.last_advanced_at),
    ended_at: optionalTimestampString(row.ended_at),
    end_reason: optionalString(row.end_reason),
    vars: jsonObject(row.vars),
    reprompt_count: nonNegativeInteger(row.reprompt_count),
    contact,
  };
}

/** List the 50 newest run-history entries for one flow in the verified account. */
export function createPostgresFlowRunListRepository(
  getVerifiedSession: AccountGuardDependencies['getVerifiedSession']
): { listForFlow: (flowId: string) => Promise<FlowRunListData> } {
  const guards = createDefaultPostgresAccountGuards(getVerifiedSession);

  async function listForFlow(flowIdInput: string): Promise<FlowRunListData> {
    const context = await guards.requireAccount();
    const flowId = requestedUuid(flowIdInput);

    const result = await withTransaction(async (transaction) => {
      // Existing RLS policies resolve auth.uid() from this transaction-local GUC.
      await transaction.query(
        "SELECT set_config('request.jwt.claim.sub', $1, true)",
        [context.userId]
      );

      const flowQuery = await transaction.query<FlowRunListFlowRow>(
        `SELECT
           f.id::text AS id,
           f.name,
           f.user_id::text AS creator_user_id,
           f.account_id::text AS account_id
         FROM public.flows AS f
         WHERE f.id = $1
           AND f.account_id = $2
         LIMIT 2`,
        [flowId, context.accountId]
      );

      if (flowQuery.rows.length === 0) throw new AppError('not_found');
      if (flowQuery.rows.length !== 1) throw new AppError('conflict');

      const flowRow = flowQuery.rows[0];
      const verifiedFlowId = uuidString(flowRow.id);
      const flowCreatorId = uuidString(flowRow.creator_user_id);
      if (
        verifiedFlowId !== flowId ||
        uuidString(flowRow.account_id) !== context.accountId
      ) {
        throw new AppError('db_error');
      }
      const flow = { id: verifiedFlowId, name: requiredString(flowRow.name) };

      const runsQuery = await transaction.query<FlowRunListRow>(
        `SELECT
           r.id::text AS id,
           r.flow_id::text AS flow_id,
           r.account_id::text AS account_id,
           r.user_id::text AS user_id,
           r.status,
           r.current_node_key,
           r.started_at,
           r.last_advanced_at,
           r.ended_at,
           r.end_reason,
           r.vars,
           r.reprompt_count,
           c.id::text AS contact_id,
           c.name AS contact_name,
           c.phone AS contact_phone
         FROM public.flow_runs AS r
         INNER JOIN public.flows AS f
           ON f.id = r.flow_id
          AND f.account_id = r.account_id
         LEFT JOIN public.contacts AS c
           ON c.id = r.contact_id
          AND c.account_id = r.account_id
         WHERE r.flow_id = $1
           AND r.account_id = $2
           AND f.id = $1
           AND f.user_id = r.user_id
         ORDER BY r.started_at DESC, r.id DESC
         LIMIT 50`,
        [flowId, context.accountId]
      );

      if (runsQuery.rows.length > RUN_LIMIT) throw new AppError('db_error');

      return {
        flow,
        runs: runsQuery.rows.map((row) =>
          toFlowRunListItem(row, flowId, context.accountId, flowCreatorId)
        ),
      };
    });

    if (!result.ok) throw result.error;
    return result.data;
  }

  return { listForFlow };
}
