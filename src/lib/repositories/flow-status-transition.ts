import 'server-only';

import type { QueryResultRow } from 'pg';
import { validateFlowForActivation } from '../flows/validate';
import type { ValidationIssue } from '../flows/validate';
import type { AccountGuardDependencies } from '../auth/postgres-account-guard';
import { createDefaultPostgresAccountGuards } from '../auth/postgres-account-guard';
import { AppError } from '../db/errors';
import { withTransaction } from '../db/postgres-client';

export type FlowStatus = 'draft' | 'active' | 'archived';

export interface FlowStatusTransitionResult {
  updated: boolean;
  flowId: string;
  status: FlowStatus;
  issues: ValidationIssue[];
}

interface FlowStatusRow extends QueryResultRow {
  id: unknown;
  name: unknown;
  status: unknown;
  trigger_type: unknown;
  trigger_config: unknown;
  entry_node_id: unknown;
}

interface FlowStatusNodeRow extends QueryResultRow {
  node_key: unknown;
  node_type: unknown;
  config: unknown;
}

interface UpdatedFlowRow extends QueryResultRow {
  id: unknown;
  status: unknown;
}

interface ActivationFlowInput {
  name: string;
  trigger_type: 'keyword' | 'first_inbound_message' | 'manual';
  trigger_config: Record<string, unknown>;
  entry_node_id: string | null;
}

const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function requestedUuid(value: unknown): string {
  if (typeof value !== 'string' || !uuidPattern.test(value)) {
    throw new AppError('bad_request');
  }
  return value.toLowerCase();
}

function returnedUuid(value: unknown): string {
  if (typeof value !== 'string' || !uuidPattern.test(value)) {
    throw new AppError('db_error');
  }
  return value.toLowerCase();
}

function flowStatus(value: unknown): FlowStatus {
  if (value === 'draft' || value === 'active' || value === 'archived') {
    return value;
  }
  throw new AppError('db_error');
}

function requestedStatus(value: unknown): FlowStatus {
  if (value === 'draft' || value === 'active' || value === 'archived') {
    return value;
  }
  throw new AppError('bad_request');
}

function requiredString(value: unknown): string {
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

function flowForValidation(
  row: FlowStatusRow,
  expectedId: string
): ActivationFlowInput {
  if (returnedUuid(row.id) !== expectedId) throw new AppError('db_error');
  const name = requiredString(row.name);
  const triggerType = requiredString(row.trigger_type);
  if (
    triggerType !== 'keyword' &&
    triggerType !== 'first_inbound_message' &&
    triggerType !== 'manual'
  ) {
    throw new AppError('db_error');
  }
  const entryNodeId = row.entry_node_id;
  if (entryNodeId !== null && typeof entryNodeId !== 'string') {
    throw new AppError('db_error');
  }
  flowStatus(row.status);

  return {
    name,
    trigger_type: triggerType,
    trigger_config: jsonObject(row.trigger_config),
    entry_node_id: entryNodeId,
  };
}

function nodesForValidation(rows: FlowStatusNodeRow[]) {
  return rows.map((row) => {
    const nodeKey = requiredString(row.node_key);
    if (nodeKey.length === 0) throw new AppError('db_error');
    return {
      node_key: nodeKey,
      node_type: requiredString(row.node_type),
      config: jsonObject(row.config),
    };
  });
}

/** Change flow status within the verified account; validate graph before activation. */
export function createPostgresFlowStatusTransitionRepository(
  getVerifiedSession: AccountGuardDependencies['getVerifiedSession']
): {
  transitionForFlow: (
    flowId: string,
    status: FlowStatus
  ) => Promise<FlowStatusTransitionResult>;
} {
  const guards = createDefaultPostgresAccountGuards(getVerifiedSession);

  async function transitionForFlow(
    flowIdInput: string,
    statusInput: FlowStatus
  ): Promise<FlowStatusTransitionResult> {
    const context = await guards.requireRole('agent');
    const flowId = requestedUuid(flowIdInput);
    const status = requestedStatus(statusInput);

    const result = await withTransaction(async (transaction) => {
      // Existing RLS policies resolve auth.uid() from this transaction-local GUC.
      await transaction.query(
        "SELECT set_config('request.jwt.claim.sub', $1, true)",
        [context.userId]
      );

      // Use the same per-account/per-flow transaction lock as graph replacement.
      await transaction.query(
        `SELECT pg_catalog.pg_advisory_xact_lock(
           pg_catalog.hashtextextended($1::text || '/' || $2::text, 0)
         )`,
        [flowId, context.accountId]
      );

      const flowQuery = await transaction.query<FlowStatusRow>(
        `SELECT
           flow.id::text AS id,
           flow.name,
           flow.status,
           flow.trigger_type,
           flow.trigger_config,
           flow.entry_node_id
         FROM public.flows AS flow
         WHERE flow.id = $1
           AND flow.account_id = $2
         LIMIT 2
         FOR UPDATE OF flow`,
        [flowId, context.accountId]
      );
      if (flowQuery.rows.length === 0) throw new AppError('not_found');
      if (flowQuery.rows.length !== 1) throw new AppError('conflict');
      const flow = flowForValidation(flowQuery.rows[0], flowId);

      let issues: ValidationIssue[] = [];
      if (status === 'active') {
        const nodesQuery = await transaction.query<FlowStatusNodeRow>(
          `SELECT node.node_key, node.node_type, node.config
           FROM public.flow_nodes AS node
           INNER JOIN public.flows AS flow
             ON flow.id = node.flow_id
           WHERE node.flow_id = $1
             AND flow.id = $1
             AND flow.account_id = $2
           ORDER BY node.node_key ASC`,
          [flowId, context.accountId]
        );
        issues = validateFlowForActivation(
          flow,
          nodesForValidation(nodesQuery.rows)
        );
        if (issues.some((issue) => issue.severity === 'error')) {
          return { updated: false, flowId, status, issues };
        }
      }

      const update = await transaction.query<UpdatedFlowRow>(
        `UPDATE public.flows AS flow
         SET status = $3,
             updated_at = NOW()
         WHERE flow.id = $1
           AND flow.account_id = $2
         RETURNING flow.id::text AS id, flow.status`,
        [flowId, context.accountId, status]
      );
      if (update.rows.length === 0) throw new AppError('not_found');
      if (update.rows.length !== 1) throw new AppError('conflict');
      if (returnedUuid(update.rows[0].id) !== flowId) {
        throw new AppError('db_error');
      }
      if (flowStatus(update.rows[0].status) !== status) {
        throw new AppError('db_error');
      }

      return { updated: true, flowId, status, issues };
    });

    if (!result.ok) throw result.error;
    return result.data;
  }

  return { transitionForFlow };
}
