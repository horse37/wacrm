import 'server-only';

import type { QueryResultRow } from 'pg';
import type { AccountGuardDependencies } from '../auth/postgres-account-guard';
import { createDefaultPostgresAccountGuards } from '../auth/postgres-account-guard';
import { AppError } from '../db/errors';
import { withTransaction } from '../db/postgres-client';

export type FlowRunEventType =
  | 'started'
  | 'node_entered'
  | 'message_sent'
  | 'reply_received'
  | 'fallback_fired'
  | 'handoff'
  | 'timeout'
  | 'error'
  | 'completed';

export interface FlowRunEventListItem {
  flow_run_id: string;
  event_type: FlowRunEventType;
  node_key: string | null;
  payload: Record<string, unknown>;
  created_at: string;
}

interface FlowRunEventFlowRow extends QueryResultRow {
  id: string | null;
  creator_user_id: string | null;
  account_id: string | null;
}

interface FlowRunEventRow extends QueryResultRow {
  event_id: string | null;
  flow_run_id: string | null;
  flow_id: string | null;
  account_id: string | null;
  user_id: string | null;
  event_type: string | null;
  node_key: string | null;
  payload: unknown;
  created_at: unknown;
}

const eventTypes = new Set<FlowRunEventType>([
  'started',
  'node_entered',
  'message_sent',
  'reply_received',
  'fallback_fired',
  'handoff',
  'timeout',
  'error',
  'completed',
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

function requestedUuid(value: unknown): string {
  try {
    return uuidString(value);
  } catch {
    throw new AppError('bad_request');
  }
}

function optionalString(value: unknown): string | null {
  if (value === null) return null;
  if (typeof value !== 'string') throw new AppError('db_error');
  return value;
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

function eventType(value: unknown): FlowRunEventType {
  if (typeof value !== 'string' || !eventTypes.has(value as FlowRunEventType)) {
    throw new AppError('db_error');
  }
  return value as FlowRunEventType;
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

function toFlowRunEventListItem(
  row: FlowRunEventRow,
  flowId: string,
  accountId: string,
  flowCreatorId: string
): FlowRunEventListItem {
  if (
    uuidString(row.flow_id) !== flowId ||
    uuidString(row.account_id) !== accountId ||
    uuidString(row.user_id) !== flowCreatorId
  ) {
    throw new AppError('db_error');
  }
  uuidString(row.event_id);

  return {
    flow_run_id: uuidString(row.flow_run_id),
    event_type: eventType(row.event_type),
    node_key: optionalString(row.node_key),
    payload: jsonObject(row.payload),
    created_at: timestampString(row.created_at),
  };
}

/** List the complete event timelines for a flow's 50 newest account-scoped runs. */
export function createPostgresFlowRunEventListRepository(
  getVerifiedSession: AccountGuardDependencies['getVerifiedSession']
): { listForFlow: (flowId: string) => Promise<FlowRunEventListItem[]> } {
  const guards = createDefaultPostgresAccountGuards(getVerifiedSession);

  async function listForFlow(
    flowIdInput: string
  ): Promise<FlowRunEventListItem[]> {
    const context = await guards.requireAccount();
    const flowId = requestedUuid(flowIdInput);

    const result = await withTransaction(async (transaction) => {
      // Existing RLS policies resolve auth.uid() from this transaction-local GUC.
      await transaction.query(
        "SELECT set_config('request.jwt.claim.sub', $1, true)",
        [context.userId]
      );

      const flowQuery = await transaction.query<FlowRunEventFlowRow>(
        `SELECT
           f.id::text AS id,
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

      const eventsQuery = await transaction.query<FlowRunEventRow>(
        `WITH recent_runs AS (
           SELECT
             r.id,
             r.flow_id,
             r.account_id,
             r.user_id
           FROM public.flow_runs AS r
           INNER JOIN public.flows AS f
             ON f.id = r.flow_id
            AND f.account_id = r.account_id
           WHERE r.flow_id = $1
             AND r.account_id = $2
             AND f.id = $1
             AND f.user_id = r.user_id
           ORDER BY r.started_at DESC, r.id DESC
           LIMIT 50
         )
         SELECT
           e.id::text AS event_id,
           e.flow_run_id::text AS flow_run_id,
           recent.flow_id::text AS flow_id,
           recent.account_id::text AS account_id,
           recent.user_id::text AS user_id,
           e.event_type,
           e.node_key,
           e.payload,
           e.created_at
         FROM public.flow_run_events AS e
         INNER JOIN recent_runs AS recent
           ON recent.id = e.flow_run_id
         ORDER BY e.created_at ASC, e.id ASC`,
        [flowId, context.accountId]
      );

      const eventIds = new Set<string>();
      const events = eventsQuery.rows.map((row) => {
        const eventId = uuidString(row.event_id);
        if (eventIds.has(eventId)) throw new AppError('db_error');
        eventIds.add(eventId);
        return toFlowRunEventListItem(
          row,
          flowId,
          context.accountId,
          flowCreatorId
        );
      });

      return events;
    });

    if (!result.ok) throw result.error;
    return result.data;
  }

  return { listForFlow };
}
