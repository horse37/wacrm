import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AppError, dbFailure, dbSuccess, toAppError } from '../db/errors';

const mocks = vi.hoisted(() => ({
  withTransaction: vi.fn(),
}));

vi.mock('server-only', () => ({}));
vi.mock('../db/postgres-client', () => ({
  withTransaction: mocks.withTransaction,
}));

import type { DbTransaction } from '../db/postgres-client';
import { createPostgresFlowEditorLoadRepository } from './flow-editor-load';

const sessionA = { userId: '00000000-0000-4000-8000-000000000003' };
const accountA = '10000000-0000-4000-8000-000000000001';
const flowId = '30000000-0000-4000-8000-000000000001';

const flowRows: Record<string, unknown>[] = [
  {
    id: flowId,
    name: 'Synthetic flow',
    description: null,
    status: 'draft',
    trigger_type: 'keyword',
    trigger_config: { keywords: ['synthetic'] },
    entry_node_id: 'start',
  },
];

const nodeRows: Record<string, unknown>[] = [
  {
    id: '40000000-0000-4000-8000-000000000001',
    node_key: 'start',
    node_type: 'start',
    config: { next_node_key: 'message' },
    position_x: -10,
    position_y: 20,
  },
  {
    id: '40000000-0000-4000-8000-000000000002',
    node_key: 'message',
    node_type: 'send_message',
    config: { text: 'Synthetic only', next_node_key: 'end' },
    position_x: 30,
    position_y: 20,
  },
];

function setupTransactions({
  flows = flowRows,
  nodes = nodeRows,
}: {
  flows?: Record<string, unknown>[];
  nodes?: Record<string, unknown>[];
} = {}) {
  const transactionQuery = vi.fn(
    async (...args: [sql: string, values?: readonly unknown[]]) => {
      const [sql] = args;
      if (sql.includes('set_config')) return { rows: [], rowCount: 1 };
      if (sql.includes('INNER JOIN public.accounts')) {
        return {
          rows: [
            {
              userId: sessionA.userId,
              accountId: accountA,
              role: 'viewer',
              accountName: 'Synthetic Account A',
            },
          ],
          rowCount: 1,
        };
      }
      if (sql.includes('FROM public.flows AS f')) {
        return { rows: flows, rowCount: flows.length };
      }
      if (sql.includes('FROM public.flow_nodes AS n')) {
        return { rows: nodes, rowCount: nodes.length };
      }
      throw new Error(`Unexpected SQL in test: ${sql}`);
    }
  );
  const transaction = { query: transactionQuery } as unknown as DbTransaction;

  mocks.withTransaction.mockImplementation(async (operation) => {
    try {
      return dbSuccess(await operation(transaction));
    } catch (error) {
      return dbFailure(toAppError(error));
    }
  });

  return transactionQuery;
}

describe('PostgreSQL flow-editor-load repository', () => {
  beforeEach(() => {
    mocks.withTransaction.mockReset();
  });

  it('requires verified account membership before loading a flow', async () => {
    const repository = createPostgresFlowEditorLoadRepository(async () => null);

    await expect(repository.getForFlow(flowId)).rejects.toEqual(
      new AppError('unauthorized')
    );
    expect(mocks.withTransaction).not.toHaveBeenCalled();
  });

  it('returns editor fields and ordered nodes without tenancy or storage metadata', async () => {
    setupTransactions();
    const repository = createPostgresFlowEditorLoadRepository(
      async () => sessionA
    );

    await expect(repository.getForFlow(flowId)).resolves.toEqual({
      flow: {
        id: flowId,
        name: 'Synthetic flow',
        description: null,
        status: 'draft',
        trigger_type: 'keyword',
        trigger_config: { keywords: ['synthetic'] },
        entry_node_id: 'start',
      },
      nodes: [
        {
          node_key: 'start',
          node_type: 'start',
          config: { next_node_key: 'message' },
          position_x: -10,
          position_y: 20,
        },
        {
          node_key: 'message',
          node_type: 'send_message',
          config: { text: 'Synthetic only', next_node_key: 'end' },
          position_x: 30,
          position_y: 20,
        },
      ],
    });
  });

  it('validates UUID and hides inaccessible flow as not found', async () => {
    const query = setupTransactions({ flows: [] });
    const repository = createPostgresFlowEditorLoadRepository(
      async () => sessionA
    );

    await expect(repository.getForFlow('bad-id')).rejects.toEqual(
      new AppError('bad_request')
    );
    await expect(repository.getForFlow(flowId)).rejects.toEqual(
      new AppError('not_found')
    );
    expect(
      query.mock.calls.some(([sql]) =>
        sql.includes('FROM public.flow_nodes AS n')
      )
    ).toBe(false);
  });

  it('uses verified account/flow scope, creator consistency, and deterministic node order', async () => {
    const query = setupTransactions();
    const repository = createPostgresFlowEditorLoadRepository(
      async () => sessionA
    );

    await repository.getForFlow(flowId);

    const flowQuery = query.mock.calls.find(([sql]) =>
      sql.includes('FROM public.flows AS f')
    );
    expect(flowQuery?.[0]).toContain('f.account_id = $1');
    expect(flowQuery?.[0]).toContain('f.id = $2');
    expect(flowQuery?.[0]).toContain('WHERE f.account_id = $1');
    expect(flowQuery?.[0]).not.toContain('public.profiles AS creator');
    expect(flowQuery?.[0]).not.toContain('SELECT *');
    expect(flowQuery?.[1]).toEqual([accountA, flowId]);

    const nodesQuery = query.mock.calls.find(([sql]) =>
      sql.includes('FROM public.flow_nodes AS n')
    );
    expect(nodesQuery?.[0]).toContain('n.flow_id = $1');
    expect(nodesQuery?.[0]).toContain('f.account_id = $2');
    expect(nodesQuery?.[0]).not.toContain('public.profiles AS creator');
    expect(nodesQuery?.[0]).toContain('ORDER BY n.created_at ASC, n.id ASC');
    expect(nodesQuery?.[0]).not.toContain('SELECT *');
    expect(nodesQuery?.[1]).toEqual([flowId, accountA]);

    expect(
      query.mock.calls.some(
        ([sql, values]) =>
          sql === "SELECT set_config('request.jwt.claim.sub', $1, true)" &&
          values?.[0] === sessionA.userId
      )
    ).toBe(true);
  });

  it.each([
    ['invalid flow UUID', 'flow', { id: 'bad-id' }],
    ['invalid status', 'flow', { status: 'paused' }],
    ['array trigger config', 'flow', { trigger_config: [] }],
    ['empty node key', 'node', { node_key: '' }],
    ['unsupported node type', 'node', { node_type: 'not_a_node' }],
    ['array node config', 'node', { config: [] }],
    ['fractional node position', 'node', { position_x: 1.5 }],
  ])('fails closed for %s', async (_label, entity, invalidFields) => {
    const flows = flowRows.map((row) => ({ ...row }));
    const nodes = nodeRows.map((row) => ({ ...row }));
    if (entity === 'flow') flows[0] = { ...flows[0], ...invalidFields };
    else nodes[0] = { ...nodes[0], ...invalidFields };
    setupTransactions({ flows, nodes });
    const repository = createPostgresFlowEditorLoadRepository(
      async () => sessionA
    );

    await expect(repository.getForFlow(flowId)).rejects.toEqual(
      new AppError('db_error')
    );
  });

  it('hides driver details behind a safe database error', async () => {
    const query = setupTransactions();
    query.mockImplementation(async (sql) => {
      if (sql.includes('set_config')) return { rows: [], rowCount: 1 };
      if (sql.includes('INNER JOIN public.accounts')) {
        return {
          rows: [
            {
              userId: sessionA.userId,
              accountId: accountA,
              role: 'viewer',
              accountName: 'Synthetic Account A',
            },
          ],
          rowCount: 1,
        };
      }
      throw new Error('synthetic driver detail must not escape');
    });
    const repository = createPostgresFlowEditorLoadRepository(
      async () => sessionA
    );

    await expect(repository.getForFlow(flowId)).rejects.toEqual(
      new AppError('db_error')
    );
  });
});
