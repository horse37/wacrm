import 'server-only';

import type { QueryResultRow } from 'pg';
import type { AccountGuardDependencies } from '../auth/postgres-account-guard';
import { createDefaultPostgresAccountGuards } from '../auth/postgres-account-guard';
import { AppError } from '../db/errors';
import { withTransaction } from '../db/postgres-client';
import type { FlowEditorNodeType } from './flow-editor-load';

export interface FlowCreateNodeInput {
  node_key: string;
  node_type: FlowEditorNodeType;
  config: Record<string, unknown>;
  position_x?: number;
  position_y?: number;
}

export interface FlowCreateInput {
  name: string;
  description?: string | null;
  trigger_type?: 'keyword' | 'first_inbound_message' | 'manual';
  trigger_config?: Record<string, unknown>;
  entry_node_id?: string | null;
  fallback_policy?: Record<string, unknown>;
  nodes?: readonly FlowCreateNodeInput[];
}

interface CreatedFlowRow extends QueryResultRow {
  id: unknown;
}

interface ValidatedFlow {
  name: string;
  description: string | null;
  trigger_type: 'keyword' | 'first_inbound_message' | 'manual';
  trigger_config: string;
  entry_node_id: string | null;
  fallback_policy?: string;
  nodes: Array<{
    node_key: string;
    node_type: FlowEditorNodeType;
    config: string;
    position_x: number;
    position_y: number;
  }>;
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

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return (
    typeof value === 'object' &&
    value !== null &&
    !Array.isArray(value) &&
    (Object.getPrototypeOf(value) === Object.prototype ||
      Object.getPrototypeOf(value) === null)
  );
}

function requestedFlow(value: unknown): ValidatedFlow {
  if (!isPlainObject(value)) throw new AppError('bad_request');
  const allowed = new Set([
    'name',
    'description',
    'trigger_type',
    'trigger_config',
    'entry_node_id',
    'fallback_policy',
    'nodes',
  ]);
  if (
    Reflect.ownKeys(value).some(
      (key) => typeof key !== 'string' || !allowed.has(key)
    )
  ) {
    throw new AppError('bad_request');
  }

  const name = value.name;
  if (typeof name !== 'string' || name.trim().length === 0) {
    throw new AppError('bad_request');
  }

  const description = value.description ?? null;
  if (description !== null && typeof description !== 'string') {
    throw new AppError('bad_request');
  }

  const triggerType = value.trigger_type ?? 'keyword';
  if (
    triggerType !== 'keyword' &&
    triggerType !== 'first_inbound_message' &&
    triggerType !== 'manual'
  ) {
    throw new AppError('bad_request');
  }

  const triggerConfig = value.trigger_config ?? {};
  if (!isPlainObject(triggerConfig)) throw new AppError('bad_request');
  const entryNodeId = value.entry_node_id ?? null;
  if (entryNodeId !== null && typeof entryNodeId !== 'string') {
    throw new AppError('bad_request');
  }

  const fallbackPolicy = Object.hasOwn(value, 'fallback_policy')
    ? value.fallback_policy
    : undefined;
  if (fallbackPolicy !== undefined && !isPlainObject(fallbackPolicy)) {
    throw new AppError('bad_request');
  }

  let triggerConfigJson: string;
  let fallbackPolicyJson: string | undefined;
  try {
    triggerConfigJson = JSON.stringify(triggerConfig);
    if (fallbackPolicy !== undefined) {
      fallbackPolicyJson = JSON.stringify(fallbackPolicy);
    }
    if (
      typeof triggerConfigJson !== 'string' ||
      (fallbackPolicy !== undefined && typeof fallbackPolicyJson !== 'string')
    ) {
      throw new Error('invalid JSON value');
    }
  } catch {
    throw new AppError('bad_request');
  }

  const nodesInput = Object.hasOwn(value, 'nodes') ? value.nodes : [];
  if (!Array.isArray(nodesInput)) throw new AppError('bad_request');
  const nodeKeys = new Set<string>();
  const nodes = nodesInput.map((candidate) => {
    if (!isPlainObject(candidate)) throw new AppError('bad_request');
    const nodeAllowed = new Set([
      'node_key',
      'node_type',
      'config',
      'position_x',
      'position_y',
    ]);
    if (
      Reflect.ownKeys(candidate).some(
        (key) => typeof key !== 'string' || !nodeAllowed.has(key)
      )
    ) {
      throw new AppError('bad_request');
    }

    const nodeKey = candidate.node_key;
    const nodeType = candidate.node_type;
    const config = candidate.config;
    if (typeof nodeKey !== 'string' || nodeKey.length === 0) {
      throw new AppError('bad_request');
    }
    if (nodeKeys.has(nodeKey)) throw new AppError('bad_request');
    nodeKeys.add(nodeKey);
    if (
      typeof nodeType !== 'string' ||
      !flowNodeTypes.has(nodeType as FlowEditorNodeType)
    ) {
      throw new AppError('bad_request');
    }
    if (!isPlainObject(config)) throw new AppError('bad_request');

    const position = (input: unknown) => {
      if (input === undefined) return 0;
      if (
        typeof input !== 'number' ||
        !Number.isInteger(input) ||
        input < -2147483648 ||
        input > 2147483647
      ) {
        throw new AppError('bad_request');
      }
      return input;
    };

    try {
      const configJson = JSON.stringify(config);
      if (typeof configJson !== 'string') throw new Error('invalid JSON value');
      return {
        node_key: nodeKey,
        node_type: nodeType as FlowEditorNodeType,
        config: configJson,
        position_x: position(candidate.position_x),
        position_y: position(candidate.position_y),
      };
    } catch {
      throw new AppError('bad_request');
    }
  });

  return {
    name: name.trim(),
    description,
    trigger_type: triggerType,
    trigger_config: triggerConfigJson,
    entry_node_id: entryNodeId,
    ...(fallbackPolicyJson === undefined
      ? {}
      : { fallback_policy: fallbackPolicyJson }),
    nodes,
  };
}

function returnedUuid(value: unknown): string {
  if (typeof value !== 'string' || !uuidPattern.test(value)) {
    throw new AppError('db_error');
  }
  return value.toLowerCase();
}

/** Create a draft flow and its optional template nodes in the verified account. */
export function createPostgresFlowCreatePersistenceRepository(
  getVerifiedSession: AccountGuardDependencies['getVerifiedSession']
): { createDraft: (input: FlowCreateInput) => Promise<string> } {
  const guards = createDefaultPostgresAccountGuards(getVerifiedSession);

  async function createDraft(input: FlowCreateInput): Promise<string> {
    const context = await guards.requireRole('agent');
    const flow = requestedFlow(input);

    const result = await withTransaction(async (transaction) => {
      // Existing RLS policies resolve auth.uid() from this transaction-local GUC.
      await transaction.query(
        "SELECT set_config('request.jwt.claim.sub', $1, true)",
        [context.userId]
      );

      const columns = [
        'user_id',
        'account_id',
        'name',
        'description',
        'status',
        'trigger_type',
        'trigger_config',
        'entry_node_id',
      ];
      const values: unknown[] = [
        context.userId,
        context.accountId,
        flow.name,
        flow.description,
        'draft',
        flow.trigger_type,
        flow.trigger_config,
        flow.entry_node_id,
      ];
      if (flow.fallback_policy !== undefined) {
        columns.push('fallback_policy');
        values.push(flow.fallback_policy);
      }
      const placeholders = values.map((_, index) => {
        const cast =
          index === 6 || (flow.fallback_policy !== undefined && index === 8)
            ? '::jsonb'
            : '';
        return `$${index + 1}${cast}`;
      });

      const created = await transaction.query<CreatedFlowRow>(
        `INSERT INTO public.flows (${columns.join(', ')})
         SELECT ${placeholders.join(', ')}
         FROM public.profiles AS creator
         WHERE creator.user_id = $1
           AND creator.account_id = $2
         RETURNING id::text AS id`,
        values
      );
      if (created.rows.length === 0) throw new AppError('forbidden');
      if (created.rows.length !== 1) throw new AppError('conflict');
      const flowId = returnedUuid(created.rows[0].id);

      for (const node of flow.nodes) {
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

      return flowId;
    });

    if (!result.ok) throw result.error;
    return result.data;
  }

  return { createDraft };
}
