import 'server-only';

import type { QueryResultRow } from 'pg';
import type { AccountGuardDependencies } from '../auth/postgres-account-guard';
import { createDefaultPostgresAccountGuards } from '../auth/postgres-account-guard';
import { AppError } from '../db/errors';
import { withTransaction } from '../db/postgres-client';
import type { FlowEditorNodeType } from './flow-editor-load';

export interface FlowNodeReplacementInput {
  node_key: string;
  node_type: FlowEditorNodeType;
  config: Record<string, unknown>;
  position_x?: number;
  position_y?: number;
}

interface FlowIdentityRow extends QueryResultRow {
  id: unknown;
}

interface ValidatedFlowNode {
  node_key: string;
  node_type: FlowEditorNodeType;
  config: string;
  position_x: number;
  position_y: number;
}

const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

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

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return (
    typeof value === 'object' &&
    value !== null &&
    !Array.isArray(value) &&
    (Object.getPrototypeOf(value) === Object.prototype ||
      Object.getPrototypeOf(value) === null)
  );
}

function jsonObject(value: unknown): string {
  if (!isPlainObject(value)) throw new AppError('bad_request');
  try {
    const serialized = JSON.stringify(value);
    if (typeof serialized !== 'string') throw new AppError('bad_request');
    return serialized;
  } catch {
    throw new AppError('bad_request');
  }
}

function position(value: unknown): number {
  if (value === undefined) return 0;
  if (
    typeof value !== 'number' ||
    !Number.isInteger(value) ||
    value < -2147483648 ||
    value > 2147483647
  ) {
    throw new AppError('bad_request');
  }
  return value;
}

function validatedNodes(value: unknown): ValidatedFlowNode[] {
  if (!Array.isArray(value)) throw new AppError('bad_request');
  const nodeKeys = new Set<string>();

  return value.map((candidate) => {
    if (!isPlainObject(candidate)) throw new AppError('bad_request');
    const nodeKey = candidate.node_key;
    const nodeType = candidate.node_type;
    if (typeof nodeKey !== 'string' || nodeKey.length === 0) {
      throw new AppError('bad_request');
    }
    if (
      typeof nodeType !== 'string' ||
      !flowNodeTypes.has(nodeType as FlowEditorNodeType)
    ) {
      throw new AppError('bad_request');
    }
    if (nodeKeys.has(nodeKey)) throw new AppError('bad_request');
    nodeKeys.add(nodeKey);

    return {
      node_key: nodeKey,
      node_type: nodeType as FlowEditorNodeType,
      config: jsonObject(candidate.config),
      position_x: position(candidate.position_x),
      position_y: position(candidate.position_y),
    };
  });
}

/** Atomically replace a flow graph only within the verified agent account. */
export function createPostgresFlowNodeGraphReplaceRepository(
  getVerifiedSession: AccountGuardDependencies['getVerifiedSession']
): {
  replaceForFlow: (
    flowId: string,
    nodes: readonly FlowNodeReplacementInput[]
  ) => Promise<void>;
} {
  const guards = createDefaultPostgresAccountGuards(getVerifiedSession);

  async function replaceForFlow(
    flowIdInput: string,
    nodesInput: readonly FlowNodeReplacementInput[]
  ): Promise<void> {
    const context = await guards.requireRole('agent');
    const flowId = requestedUuid(flowIdInput);
    const nodes = validatedNodes(nodesInput);

    const result = await withTransaction(async (transaction) => {
      // Existing RLS policies resolve auth.uid() from this transaction-local GUC.
      await transaction.query(
        "SELECT set_config('request.jwt.claim.sub', $1, true)",
        [context.userId]
      );

      // Coordinate graph edits with activation without requiring UPDATE on flows.
      await transaction.query(
        `SELECT pg_catalog.pg_advisory_xact_lock(
           pg_catalog.hashtextextended($1::text || '/' || $2::text, 0)
         )`,
        [flowId, context.accountId]
      );

      const parent = await transaction.query<FlowIdentityRow>(
        `SELECT flow.id::text AS id
         FROM public.flows AS flow
         WHERE flow.id = $1
           AND flow.account_id = $2
         LIMIT 2`,
        [flowId, context.accountId]
      );
      if (parent.rows.length === 0) throw new AppError('not_found');
      if (parent.rows.length !== 1) throw new AppError('conflict');
      if (returnedUuid(parent.rows[0].id) !== flowId) {
        throw new AppError('db_error');
      }

      await transaction.query(
        `DELETE FROM public.flow_nodes AS node
         WHERE node.flow_id = $1
           AND EXISTS (
             SELECT 1
             FROM public.flows AS flow
             WHERE flow.id = node.flow_id
               AND flow.id = $1
               AND flow.account_id = $2
           )`,
        [flowId, context.accountId]
      );

      for (const node of nodes) {
        await transaction.query(
          `INSERT INTO public.flow_nodes (
             flow_id,
             node_key,
             node_type,
             config,
             position_x,
             position_y
           ) VALUES ($1, $2, $3, $4::jsonb, $5, $6)`,
          [
            flowId,
            node.node_key,
            node.node_type,
            node.config,
            node.position_x,
            node.position_y,
          ]
        );
      }
    });

    if (!result.ok) throw result.error;
  }

  return { replaceForFlow };
}
