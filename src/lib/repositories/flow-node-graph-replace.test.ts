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
import type { FlowNodeReplacementInput } from './flow-node-graph-replace';
import { createPostgresFlowNodeGraphReplaceRepository } from './flow-node-graph-replace';

const sessionA = { userId: '00000000-0000-4000-8000-000000000002' };
const accountA = '10000000-0000-4000-8000-000000000001';
const flowA = '70000000-0000-4000-8000-000000000001';
const membershipA = {
  userId: sessionA.userId,
  accountId: accountA,
  role: 'agent',
  accountName: 'Synthetic Account A',
};

const replacementNodes: FlowNodeReplacementInput[] = [
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
  },
];

function setupTransactions({
  role = 'agent',
  parentRows = [{ id: flowA }],
  failOnInsert = false,
}: {
  role?: string;
  parentRows?: Record<string, unknown>[];
  failOnInsert?: boolean;
} = {}) {
  const transactionQuery = vi.fn(
    async (...args: [sql: string, values?: readonly unknown[]]) => {
      const [sql] = args;
      if (sql.includes('set_config')) return { rows: [], rowCount: 1 };
      if (sql.includes('pg_advisory_xact_lock')) {
        return { rows: [], rowCount: 1 };
      }
      if (sql.includes('INNER JOIN public.accounts')) {
        return { rows: [{ ...membershipA, role }], rowCount: 1 };
      }
      if (sql.includes('SELECT flow.id::text AS id')) {
        return { rows: parentRows, rowCount: parentRows.length };
      }
      if (sql.includes('DELETE FROM public.flow_nodes AS node')) {
        return { rows: [], rowCount: 2 };
      }
      if (sql.includes('INSERT INTO public.flow_nodes')) {
        if (failOnInsert) throw new Error('synthetic constraint failure');
        return { rows: [], rowCount: 1 };
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

describe('PostgreSQL flow-node graph replacement repository', () => {
  beforeEach(() => {
    mocks.withTransaction.mockReset();
  });

  it('requires a verified session before opening a mutation transaction', async () => {
    const repository = createPostgresFlowNodeGraphReplaceRepository(
      async () => null
    );

    await expect(
      repository.replaceForFlow(flowA, replacementNodes)
    ).rejects.toEqual(new AppError('unauthorized'));
    expect(mocks.withTransaction).not.toHaveBeenCalled();
  });

  it('denies viewers before deleting existing nodes', async () => {
    const query = setupTransactions({ role: 'viewer' });
    const repository = createPostgresFlowNodeGraphReplaceRepository(
      async () => sessionA
    );

    await expect(
      repository.replaceForFlow(flowA, replacementNodes)
    ).rejects.toEqual(new AppError('forbidden'));
    expect(
      query.mock.calls.some(([sql]) =>
        sql.includes('DELETE FROM public.flow_nodes AS node')
      )
    ).toBe(false);
  });

  it('validates the flow UUID and graph before any mutation query', async () => {
    const query = setupTransactions();
    const repository = createPostgresFlowNodeGraphReplaceRepository(
      async () => sessionA
    );

    await expect(
      repository.replaceForFlow('invalid', replacementNodes)
    ).rejects.toEqual(new AppError('bad_request'));
    await expect(
      repository.replaceForFlow(flowA, [
        ...replacementNodes,
        { ...replacementNodes[0] },
      ] as never)
    ).rejects.toEqual(new AppError('bad_request'));
    expect(
      query.mock.calls.some(([sql]) =>
        sql.includes('DELETE FROM public.flow_nodes AS node')
      )
    ).toBe(false);
  });

  it.each([
    ['empty key', [{ node_key: '', node_type: 'end', config: {} }]],
    ['unknown type', [{ node_key: 'start', node_type: 'unknown', config: {} }]],
    ['array config', [{ node_key: 'start', node_type: 'start', config: [] }]],
    [
      'fractional position',
      [{ node_key: 'start', node_type: 'start', config: {}, position_x: 1.5 }],
    ],
    [
      'out-of-range position',
      [
        {
          node_key: 'start',
          node_type: 'start',
          config: {},
          position_y: 2147483648,
        },
      ],
    ],
  ])('rejects %s before deleting the saved graph', async (_label, nodes) => {
    const query = setupTransactions();
    const repository = createPostgresFlowNodeGraphReplaceRepository(
      async () => sessionA
    );

    await expect(
      repository.replaceForFlow(flowA, nodes as never)
    ).rejects.toEqual(new AppError('bad_request'));
    expect(
      query.mock.calls.some(([sql]) =>
        sql.includes('DELETE FROM public.flow_nodes AS node')
      )
    ).toBe(false);
  });

  it('checks the verified account and creator consistency before replacement', async () => {
    const query = setupTransactions();
    const repository = createPostgresFlowNodeGraphReplaceRepository(
      async () => sessionA
    );

    await repository.replaceForFlow(flowA, replacementNodes);

    const parent = query.mock.calls.find(([sql]) =>
      sql.includes('SELECT flow.id::text AS id')
    );
    expect(parent?.[0]).toContain('flow.id = $1');
    expect(parent?.[0]).toContain('flow.account_id = $2');
    expect(parent?.[0]).toContain('flow.account_id = $2');
    expect(parent?.[0]).not.toContain('public.profiles AS creator');
    expect(parent?.[0]).not.toContain('FOR UPDATE');
    expect(parent?.[1]).toEqual([flowA, accountA]);

    const advisoryLockIndex = query.mock.calls.findIndex(([sql]) =>
      sql.includes('pg_advisory_xact_lock')
    );
    const parentIndex = query.mock.calls.findIndex(([sql]) =>
      sql.includes('SELECT flow.id::text AS id')
    );
    expect(advisoryLockIndex).toBeGreaterThan(-1);
    expect(advisoryLockIndex).toBeLessThan(parentIndex);
    expect(query.mock.calls[advisoryLockIndex]?.[1]).toEqual([flowA, accountA]);

    const deletion = query.mock.calls.find(([sql]) =>
      sql.includes('DELETE FROM public.flow_nodes AS node')
    );
    expect(deletion?.[0]).toContain('node.flow_id = $1');
    expect(deletion?.[0]).toContain('flow.account_id = $2');
    expect(deletion?.[1]).toEqual([flowA, accountA]);

    const inserts = query.mock.calls.filter(([sql]) =>
      sql.includes('INSERT INTO public.flow_nodes')
    );
    expect(inserts).toHaveLength(2);
    expect(inserts[0]?.[1]).toEqual([
      flowA,
      'start',
      'start',
      JSON.stringify({ next_node_key: 'message' }),
      -10,
      20,
    ]);
    expect(inserts[1]?.[1]).toEqual([
      flowA,
      'message',
      'send_message',
      JSON.stringify({ text: 'Synthetic only', next_node_key: 'end' }),
      0,
      0,
    ]);
    expect(
      query.mock.calls.some(
        ([sql, values]) =>
          sql === "SELECT set_config('request.jwt.claim.sub', $1, true)" &&
          values?.[0] === sessionA.userId
      )
    ).toBe(true);
  });

  it('supports http_fetch and send_media nodes and clears the graph for an empty array', async () => {
    const query = setupTransactions();
    const repository = createPostgresFlowNodeGraphReplaceRepository(
      async () => sessionA
    );

    await repository.replaceForFlow(flowA, [
      {
        node_key: 'fetch',
        node_type: 'http_fetch',
        config: { url: 'https://example.invalid' },
      },
      {
        node_key: 'media',
        node_type: 'send_media',
        config: {
          media_type: 'image',
          media_url: 'https://example.invalid/synthetic.png',
          next_node_key: 'end',
        },
      },
    ]);
    expect(
      query.mock.calls.find(([sql]) =>
        sql.includes('INSERT INTO public.flow_nodes')
      )?.[1]
    ).toEqual([
      flowA,
      'fetch',
      'http_fetch',
      JSON.stringify({ url: 'https://example.invalid' }),
      0,
      0,
    ]);
    expect(
      query.mock.calls.filter(([sql]) =>
        sql.includes('INSERT INTO public.flow_nodes')
      )?.[1]?.[1]
    ).toEqual([
      flowA,
      'media',
      'send_media',
      JSON.stringify({
        media_type: 'image',
        media_url: 'https://example.invalid/synthetic.png',
        next_node_key: 'end',
      }),
      0,
      0,
    ]);

    query.mockClear();
    await repository.replaceForFlow(flowA, []);
    expect(
      query.mock.calls.some(([sql]) =>
        sql.includes('DELETE FROM public.flow_nodes AS node')
      )
    ).toBe(true);
    expect(
      query.mock.calls.some(([sql]) =>
        sql.includes('INSERT INTO public.flow_nodes')
      )
    ).toBe(false);
  });

  it('returns not found without deleting nodes when the flow is inaccessible', async () => {
    const query = setupTransactions({ parentRows: [] });
    const repository = createPostgresFlowNodeGraphReplaceRepository(
      async () => sessionA
    );

    await expect(
      repository.replaceForFlow(flowA, replacementNodes)
    ).rejects.toEqual(new AppError('not_found'));
    expect(
      query.mock.calls.some(([sql]) =>
        sql.includes('DELETE FROM public.flow_nodes AS node')
      )
    ).toBe(false);
  });

  it('returns safe conflicts and relies on transaction rollback after insert failure', async () => {
    const query = setupTransactions({
      parentRows: [{ id: flowA }, { id: flowA }],
    });
    const conflictRepository = createPostgresFlowNodeGraphReplaceRepository(
      async () => sessionA
    );
    await expect(
      conflictRepository.replaceForFlow(flowA, replacementNodes)
    ).rejects.toEqual(new AppError('conflict'));
    expect(
      query.mock.calls.some(([sql]) =>
        sql.includes('DELETE FROM public.flow_nodes AS node')
      )
    ).toBe(false);

    const failedInsert = setupTransactions({ failOnInsert: true });
    const failingRepository = createPostgresFlowNodeGraphReplaceRepository(
      async () => sessionA
    );
    await expect(
      failingRepository.replaceForFlow(flowA, replacementNodes)
    ).rejects.toEqual(new AppError('db_error'));
    const deleteIndex = failedInsert.mock.calls.findIndex(([sql]) =>
      sql.includes('DELETE FROM public.flow_nodes AS node')
    );
    const insertIndex = failedInsert.mock.calls.findIndex(([sql]) =>
      sql.includes('INSERT INTO public.flow_nodes')
    );
    expect(deleteIndex).toBeGreaterThan(-1);
    expect(insertIndex).toBeGreaterThan(deleteIndex);
  });

  it('propagates safe database errors without driver details', async () => {
    const databaseFailure = new AppError('db_error');
    mocks.withTransaction
      .mockResolvedValueOnce(dbSuccess(membershipA))
      .mockResolvedValueOnce(dbFailure(databaseFailure));
    const repository = createPostgresFlowNodeGraphReplaceRepository(
      async () => sessionA
    );

    await expect(
      repository.replaceForFlow(flowA, replacementNodes)
    ).rejects.toBe(databaseFailure);
  });
});
