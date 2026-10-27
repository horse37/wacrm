import 'server-only';

import type { QueryResultRow } from 'pg';
import type { FlowNodeType } from '../flows/types';
import type { AccountGuardDependencies } from '../auth/postgres-account-guard';
import { createDefaultPostgresAccountGuards } from '../auth/postgres-account-guard';
import { AppError } from '../db/errors';
import { withTransaction } from '../db/postgres-client';

export type FlowEditorStatus = 'draft' | 'active' | 'archived';
export type FlowEditorTriggerType =
  | 'keyword'
  | 'first_inbound_message'
  | 'manual';
export type FlowEditorNodeType = FlowNodeType | 'http_fetch';

export interface FlowEditorFlow {
  id: string;
  name: string;
  description: string | null;
  status: FlowEditorStatus;
  trigger_type: FlowEditorTriggerType;
  trigger_config: Record<string, unknown>;
  entry_node_id: string | null;
}

export interface FlowEditorNode {
  node_key: string;
  node_type: FlowEditorNodeType;
  config: Record<string, unknown>;
  position_x: number;
  position_y: number;
}

export interface FlowEditorData {
  flow: FlowEditorFlow;
  nodes: FlowEditorNode[];
}

interface FlowEditorRow extends QueryResultRow {
  id: string | null;
  name: string | null;
  description: string | null;
  status: string | null;
  trigger_type: string | null;
  trigger_config: unknown;
  entry_node_id: string | null;
}

interface FlowEditorNodeRow extends QueryResultRow {
  id: string | null;
  node_key: string | null;
  node_type: string | null;
  config: unknown;
  position_x: number | null;
  position_y: number | null;
}

const flowNodeTypes = new Set<FlowEditorNodeType>([
  'start',
  'send_message',
  'send_buttons',
  'send_list',
  'send_media',
  'collect_input',
  'condition',
  'set_tag',
  'handoff',
  'http_fetch',
  'end',
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

function requiredString(value: unknown): string {
  if (typeof value !== 'string') throw new AppError('db_error');
  return value;
}

function nonEmptyString(value: unknown): string {
  const result = requiredString(value);
  if (result.length === 0) throw new AppError('db_error');
  return result;
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

function flowStatus(value: unknown): FlowEditorStatus {
  if (value === 'draft' || value === 'active' || value === 'archived') {
    return value;
  }
  throw new AppError('db_error');
}

function triggerType(value: unknown): FlowEditorTriggerType {
  if (
    value === 'keyword' ||
    value === 'first_inbound_message' ||
    value === 'manual'
  ) {
    return value;
  }
  throw new AppError('db_error');
}

function entryNodeId(value: unknown): string | null {
  if (value === null) return null;
  return requiredString(value);
}

function position(value: unknown): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value)) {
    throw new AppError('db_error');
  }
  return value;
}

function toFlowEditor(row: FlowEditorRow, expectedId: string): FlowEditorFlow {
  const id = uuidString(row.id);
  if (id !== expectedId) throw new AppError('db_error');

  return {
    id,
    name: requiredString(row.name),
    description: optionalString(row.description),
    status: flowStatus(row.status),
    trigger_type: triggerType(row.trigger_type),
    trigger_config: jsonObject(row.trigger_config),
    entry_node_id: entryNodeId(row.entry_node_id),
  };
}

function toFlowEditorNode(row: FlowEditorNodeRow): FlowEditorNode {
  uuidString(row.id);
  const nodeType = requiredString(row.node_type);
  if (!flowNodeTypes.has(nodeType as FlowNodeType)) {
    throw new AppError('db_error');
  }

  return {
    node_key: nonEmptyString(row.node_key),
    node_type: nodeType as FlowEditorNodeType,
    config: jsonObject(row.config),
    position_x: position(row.position_x),
    position_y: position(row.position_y),
  };
}

/** Load editor-consumed flow fields and nodes for the verified account. */
export function createPostgresFlowEditorLoadRepository(
  getVerifiedSession: AccountGuardDependencies['getVerifiedSession']
): { getForFlow: (flowId: string) => Promise<FlowEditorData> } {
  const guards = createDefaultPostgresAccountGuards(getVerifiedSession);

  async function getForFlow(flowIdInput: string): Promise<FlowEditorData> {
    const context = await guards.requireAccount();
    const flowId = requestedUuid(flowIdInput);

    const result = await withTransaction(async (transaction) => {
      // Existing RLS policies resolve auth.uid() from this transaction-local GUC.
      await transaction.query(
        "SELECT set_config('request.jwt.claim.sub', $1, true)",
        [context.userId]
      );

      const flowQuery = await transaction.query<FlowEditorRow>(
        `SELECT
           f.id::text AS id,
           f.name,
           f.description,
           f.status,
           f.trigger_type,
           f.trigger_config,
           f.entry_node_id
         FROM public.flows AS f
         WHERE f.account_id = $1
           AND f.id = $2
         LIMIT 2`,
        [context.accountId, flowId]
      );

      if (flowQuery.rows.length === 0) throw new AppError('not_found');
      if (flowQuery.rows.length !== 1) throw new AppError('conflict');
      const flow = toFlowEditor(flowQuery.rows[0], flowId);

      const nodesQuery = await transaction.query<FlowEditorNodeRow>(
        `SELECT
           n.id::text AS id,
           n.node_key,
           n.node_type,
           n.config,
           n.position_x,
           n.position_y
         FROM public.flow_nodes AS n
         INNER JOIN public.flows AS f
           ON f.id = n.flow_id
         WHERE n.flow_id = $1
           AND f.id = $1
           AND f.account_id = $2
         ORDER BY n.created_at ASC, n.id ASC`,
        [flowId, context.accountId]
      );

      const nodes = nodesQuery.rows.map(toFlowEditorNode);
      const nodeKeys = new Set<string>();
      for (const node of nodes) {
        if (nodeKeys.has(node.node_key)) throw new AppError('db_error');
        nodeKeys.add(node.node_key);
      }

      return { flow, nodes };
    });

    if (!result.ok) throw result.error;
    return result.data;
  }

  return { getForFlow };
}
