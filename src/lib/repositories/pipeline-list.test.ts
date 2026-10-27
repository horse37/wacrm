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
import { createPostgresPipelineListRepository } from './pipeline-list';

const sessionA = { userId: '00000000-0000-4000-8000-000000000001' };
const accountA = '10000000-0000-4000-8000-000000000001';
const pipelineA = '50000000-0000-4000-8000-000000000001';
const pipelineRowA = {
  id: pipelineA,
  user_id: sessionA.userId,
  account_id: accountA,
  name: 'Pipeline A',
  created_at: new Date('2026-10-18T10:00:00.000Z'),
};

const membershipA = {
  userId: sessionA.userId,
  accountId: accountA,
  role: 'viewer',
  accountName: 'Synthetic Account A',
};

function setupTransactions({
  role = 'viewer',
  pipelineRows = [pipelineRowA],
}: {
  role?: string;
  pipelineRows?: Record<string, unknown>[];
} = {}) {
  const transactionQuery = vi.fn(
    async (...args: [sql: string, values?: readonly unknown[]]) => {
      const [sql] = args;
      if (sql.includes('set_config')) return { rows: [], rowCount: 1 };
      if (sql.includes('INNER JOIN public.accounts')) {
        return {
          rows: [{ ...membershipA, role }],
          rowCount: 1,
        };
      }
      if (sql.includes('FROM public.pipelines AS p')) {
        return { rows: pipelineRows, rowCount: pipelineRows.length };
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

describe('PostgreSQL pipeline list repository', () => {
  beforeEach(() => {
    mocks.withTransaction.mockReset();
  });

  it('requires a verified session before querying pipelines', async () => {
    const repository = createPostgresPipelineListRepository(async () => null);

    await expect(repository.listForAccount()).rejects.toEqual(
      new AppError('unauthorized')
    );
    expect(mocks.withTransaction).not.toHaveBeenCalled();
  });

  it('allows viewers and scopes pipelines to the verified account', async () => {
    const query = setupTransactions();
    const repository = createPostgresPipelineListRepository(
      async () => sessionA
    );

    await expect(repository.listForAccount()).resolves.toEqual([
      {
        id: pipelineA,
        user_id: sessionA.userId,
        name: 'Pipeline A',
        created_at: '2026-10-18T10:00:00.000Z',
      },
    ]);

    expect(query.mock.calls[0]).toEqual([
      "SELECT set_config('request.jwt.claim.sub', $1, true)",
      [sessionA.userId],
    ]);
    expect(query.mock.calls[2]).toEqual([
      "SELECT set_config('request.jwt.claim.sub', $1, true)",
      [sessionA.userId],
    ]);
    const [sql, values] = query.mock.calls[3] ?? [];
    expect(sql).toContain('WHERE p.account_id = $1');
    expect(sql).not.toContain('public.profiles AS creator');
    expect(sql).toContain('WHERE p.account_id = $1');
    expect(sql).toContain('ORDER BY p.created_at ASC NULLS LAST, p.id ASC');
    expect(values).toEqual([accountA]);
  });

  it('returns an empty list for an account without pipelines', async () => {
    setupTransactions({ pipelineRows: [] });
    const repository = createPostgresPipelineListRepository(
      async () => sessionA
    );

    await expect(repository.listForAccount()).resolves.toEqual([]);
  });

  it('preserves a null creation timestamp from the legacy schema', async () => {
    setupTransactions({
      pipelineRows: [{ ...pipelineRowA, created_at: null }],
    });
    const repository = createPostgresPipelineListRepository(
      async () => sessionA
    );

    await expect(repository.listForAccount()).resolves.toEqual([
      {
        id: pipelineA,
        user_id: sessionA.userId,
        name: 'Pipeline A',
        created_at: null,
      },
    ]);
  });

  it('rejects malformed or cross-account pipeline rows safely', async () => {
    setupTransactions({
      pipelineRows: [
        {
          ...pipelineRowA,
          account_id: '10000000-0000-4000-8000-000000000002',
        },
      ],
    });
    const repository = createPostgresPipelineListRepository(
      async () => sessionA
    );

    await expect(repository.listForAccount()).rejects.toEqual(
      new AppError('db_error')
    );

    setupTransactions({ pipelineRows: [{ ...pipelineRowA, id: null }] });
    await expect(repository.listForAccount()).rejects.toEqual(
      new AppError('db_error')
    );
  });

  it('propagates safe database errors without exposing driver details', async () => {
    const databaseFailure = new AppError('db_error');
    mocks.withTransaction
      .mockResolvedValueOnce(dbSuccess(membershipA))
      .mockResolvedValueOnce(dbFailure(databaseFailure));
    const repository = createPostgresPipelineListRepository(
      async () => sessionA
    );

    await expect(repository.listForAccount()).rejects.toBe(databaseFailure);
  });
});
