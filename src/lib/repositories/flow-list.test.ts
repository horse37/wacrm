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
import { createPostgresFlowListRepository } from './flow-list';

const sessionA = { userId: '00000000-0000-4000-8000-000000000003' };
const accountA = '10000000-0000-4000-8000-000000000001';
const flowRows: Record<string, unknown>[] = [
  {
    id: '30000000-0000-4000-8000-000000000002',
    name: 'Newest flow',
    description: null,
    status: 'active',
    trigger_type: 'keyword',
    trigger_config: { keywords: ['synthetic', 'test'] },
    execution_count: 12,
    created_at: '2026-10-19T10:00:00.000Z',
    creator_user_id: '00000000-0000-4000-8000-000000000001',
  },
  {
    id: '30000000-0000-4000-8000-000000000001',
    name: 'Older flow',
    description: 'Synthetic description',
    status: 'draft',
    trigger_type: 'manual',
    trigger_config: {},
    execution_count: 0,
    created_at: '2026-10-18T10:00:00.000Z',
    creator_user_id: '00000000-0000-4000-8000-000000000001',
  },
];

function setupTransactions({
  role = 'viewer',
  flows = flowRows,
}: {
  role?: string;
  flows?: Record<string, unknown>[];
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
              role,
              accountName: 'Synthetic Account A',
            },
          ],
          rowCount: 1,
        };
      }
      if (sql.includes('FROM public.flows AS f')) {
        return { rows: flows, rowCount: flows.length };
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

describe('PostgreSQL flow-list repository', () => {
  beforeEach(() => {
    mocks.withTransaction.mockReset();
  });

  it('requires verified account membership before listing flows', async () => {
    const repository = createPostgresFlowListRepository(async () => null);

    await expect(repository.listForCurrentAccount()).rejects.toEqual(
      new AppError('unauthorized')
    );
    expect(mocks.withTransaction).not.toHaveBeenCalled();
  });

  it('returns ordered, validated fields consumed by the list screen', async () => {
    setupTransactions();
    const repository = createPostgresFlowListRepository(async () => sessionA);

    await expect(repository.listForCurrentAccount()).resolves.toEqual([
      {
        id: '30000000-0000-4000-8000-000000000002',
        name: 'Newest flow',
        description: null,
        status: 'active',
        trigger_type: 'keyword',
        trigger_config: { keywords: ['synthetic', 'test'] },
        execution_count: 12,
      },
      {
        id: '30000000-0000-4000-8000-000000000001',
        name: 'Older flow',
        description: 'Synthetic description',
        status: 'draft',
        trigger_type: 'manual',
        trigger_config: {},
        execution_count: 0,
      },
    ]);
  });

  it('uses explicit account and creator consistency with stable order', async () => {
    const query = setupTransactions();
    const repository = createPostgresFlowListRepository(async () => sessionA);

    await repository.listForCurrentAccount();

    const list = query.mock.calls.find(([sql]) =>
      sql.includes('FROM public.flows AS f')
    );
    expect(list?.[0]).toContain('f.account_id = $1');
    expect(list?.[0]).toContain('WHERE f.account_id = $1');
    expect(list?.[0]).not.toContain('public.profiles AS creator');
    expect(list?.[0]).toContain('ORDER BY f.created_at DESC, f.id DESC');
    expect(list?.[0]).not.toContain('SELECT *');
    expect(list?.[1]).toEqual([accountA]);
    expect(
      query.mock.calls.some(
        ([sql, values]) =>
          sql === "SELECT set_config('request.jwt.claim.sub', $1, true)" &&
          values?.[0] === sessionA.userId
      )
    ).toBe(true);
  });

  it('returns an empty list for an account without flows', async () => {
    setupTransactions({ flows: [] });
    const repository = createPostgresFlowListRepository(async () => sessionA);

    await expect(repository.listForCurrentAccount()).resolves.toEqual([]);
  });

  it.each([
    ['invalid ID', { id: 'bad-id' }],
    ['invalid status', { status: 'paused' }],
    ['invalid trigger type', { trigger_type: 'scheduled' }],
    ['array trigger config', { trigger_config: [] }],
    ['negative execution count', { execution_count: -1 }],
    ['fractional execution count', { execution_count: 1.5 }],
  ])('fails closed for %s', async (_label, invalidFields) => {
    const flows = flowRows.map((row) => ({ ...row }));
    flows[0] = { ...flows[0], ...invalidFields };
    setupTransactions({ flows });
    const repository = createPostgresFlowListRepository(async () => sessionA);

    await expect(repository.listForCurrentAccount()).rejects.toEqual(
      new AppError('db_error')
    );
  });

  it('hides driver errors behind a safe database error', async () => {
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
    const repository = createPostgresFlowListRepository(async () => sessionA);

    await expect(repository.listForCurrentAccount()).rejects.toEqual(
      new AppError('db_error')
    );
  });
});
