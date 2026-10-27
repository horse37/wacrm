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
import { createPostgresFlowStatusTransitionRepository } from './flow-status-transition';

const sessionA = { userId: '00000000-0000-4000-8000-000000000002' };
const accountA = '10000000-0000-4000-8000-000000000001';
const flowA = '70000000-0000-4000-8000-000000000001';
const membershipA = {
  userId: sessionA.userId,
  accountId: accountA,
  role: 'agent',
  accountName: 'Synthetic Account A',
};

const validFlow = {
  id: flowA,
  name: 'Synthetic activation',
  status: 'draft',
  trigger_type: 'manual',
  trigger_config: {},
  entry_node_id: 'start',
};

const validNodes = [
  {
    id: '80000000-0000-4000-8000-000000000001',
    node_key: 'start',
    node_type: 'start',
    config: { next_node_key: 'end' },
  },
  {
    id: '80000000-0000-4000-8000-000000000002',
    node_key: 'end',
    node_type: 'end',
    config: {},
  },
];

function setupTransactions({
  role = 'agent',
  flowRows = [validFlow],
  nodeRows = validNodes,
}: {
  role?: string;
  flowRows?: Record<string, unknown>[];
  nodeRows?: Record<string, unknown>[];
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
      if (sql.includes('FOR UPDATE OF flow')) {
        return { rows: flowRows, rowCount: flowRows.length };
      }
      if (sql.includes('SELECT node.node_key')) {
        return { rows: nodeRows, rowCount: nodeRows.length };
      }
      if (sql.includes('UPDATE public.flows AS flow')) {
        const status = args[1]?.[2];
        return {
          rows: [{ id: flowA, status }],
          rowCount: 1,
        };
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

describe('PostgreSQL flow status transition repository', () => {
  beforeEach(() => {
    mocks.withTransaction.mockReset();
  });

  it('requires a verified session before opening a transaction', async () => {
    const repository = createPostgresFlowStatusTransitionRepository(
      async () => null
    );

    await expect(repository.transitionForFlow(flowA, 'active')).rejects.toEqual(
      new AppError('unauthorized')
    );
    expect(mocks.withTransaction).not.toHaveBeenCalled();
  });

  it('denies viewers before locking the flow', async () => {
    const query = setupTransactions({ role: 'viewer' });
    const repository = createPostgresFlowStatusTransitionRepository(
      async () => sessionA
    );

    await expect(repository.transitionForFlow(flowA, 'active')).rejects.toEqual(
      new AppError('forbidden')
    );
    expect(query.mock.calls.some(([sql]) => sql.includes('FOR UPDATE'))).toBe(
      false
    );
    expect(
      query.mock.calls.some(([sql]) => sql.includes('pg_advisory_xact_lock'))
    ).toBe(false);
  });

  it('validates UUID and status before opening the write transaction', async () => {
    const query = setupTransactions();
    const repository = createPostgresFlowStatusTransitionRepository(
      async () => sessionA
    );

    await expect(
      repository.transitionForFlow('invalid', 'active')
    ).rejects.toEqual(new AppError('bad_request'));
    await expect(
      repository.transitionForFlow(flowA, 'deleted' as 'active')
    ).rejects.toEqual(new AppError('bad_request'));
    expect(
      query.mock.calls.some(([sql]) =>
        sql.includes('UPDATE public.flows AS flow')
      )
    ).toBe(false);
  });

  it('activates a valid graph after locking and reading it in the transaction', async () => {
    const query = setupTransactions();
    const repository = createPostgresFlowStatusTransitionRepository(
      async () => sessionA
    );

    await expect(
      repository.transitionForFlow(flowA, 'active')
    ).resolves.toEqual({
      updated: true,
      flowId: flowA,
      status: 'active',
      issues: [],
    });

    const lockIndex = query.mock.calls.findIndex(([sql]) =>
      sql.includes('FOR UPDATE')
    );
    const advisoryLockIndex = query.mock.calls.findIndex(([sql]) =>
      sql.includes('pg_advisory_xact_lock')
    );
    const nodeIndex = query.mock.calls.findIndex(([sql]) =>
      sql.includes('SELECT node.node_key')
    );
    const updateIndex = query.mock.calls.findIndex(([sql]) =>
      sql.includes('UPDATE public.flows AS flow')
    );
    expect(advisoryLockIndex).toBeGreaterThan(-1);
    expect(advisoryLockIndex).toBeLessThan(lockIndex);
    expect(lockIndex).toBeGreaterThan(-1);
    expect(nodeIndex).toBeGreaterThan(lockIndex);
    expect(updateIndex).toBeGreaterThan(nodeIndex);
    expect(query.mock.calls[updateIndex][1]).toEqual([
      flowA,
      accountA,
      'active',
    ]);
    expect(query.mock.calls[advisoryLockIndex]?.[1]).toEqual([flowA, accountA]);
  });

  it('returns blocking validation issues without updating an invalid graph', async () => {
    const query = setupTransactions({ nodeRows: [] });
    const repository = createPostgresFlowStatusTransitionRepository(
      async () => sessionA
    );

    const result = await repository.transitionForFlow(flowA, 'active');

    expect(result.updated).toBe(false);
    expect(result.issues.some((issue) => issue.severity === 'error')).toBe(
      true
    );
    expect(
      query.mock.calls.some(([sql]) =>
        sql.includes('UPDATE public.flows AS flow')
      )
    ).toBe(false);
  });

  it('allows warnings when activation has no error blockers', async () => {
    const query = setupTransactions({
      nodeRows: [
        ...validNodes,
        {
          id: '80000000-0000-4000-8000-000000000003',
          node_key: 'unreachable',
          node_type: 'end',
          config: {},
        },
      ],
    });
    const repository = createPostgresFlowStatusTransitionRepository(
      async () => sessionA
    );

    const result = await repository.transitionForFlow(flowA, 'active');

    expect(result.updated).toBe(true);
    expect(result.issues).toEqual([
      expect.objectContaining({ severity: 'warning', node_key: 'unreachable' }),
    ]);
    expect(query.mock.calls.some(([sql]) => sql.includes('UPDATE'))).toBe(true);
  });

  it.each(['draft', 'archived'] as const)(
    'updates to %s without loading or validating nodes',
    async (status) => {
      const query = setupTransactions();
      const repository = createPostgresFlowStatusTransitionRepository(
        async () => sessionA
      );

      await expect(
        repository.transitionForFlow(flowA, status)
      ).resolves.toEqual({ updated: true, flowId: flowA, status, issues: [] });
      expect(
        query.mock.calls.some(([sql]) => sql.includes('SELECT node.node_key'))
      ).toBe(false);
    }
  );

  it('returns not found when the flow is outside the verified account', async () => {
    const query = setupTransactions({ flowRows: [] });
    const repository = createPostgresFlowStatusTransitionRepository(
      async () => sessionA
    );

    await expect(repository.transitionForFlow(flowA, 'draft')).rejects.toEqual(
      new AppError('not_found')
    );
    expect(
      query.mock.calls.some(([sql]) =>
        sql.includes('UPDATE public.flows AS flow')
      )
    ).toBe(false);
  });
});
