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
import { createPostgresTemplateManagerCountsRepository } from './template-manager-counts';

const sessionA = { userId: '00000000-0000-4000-8000-000000000003' };
const accountA = '10000000-0000-4000-8000-000000000001';

function setupTransactions({
  counts = { totalCount: '4', pendingCount: '2' },
}: {
  counts?: Record<string, unknown>;
} = {}) {
  const queries: Array<readonly [sql: string, values?: readonly unknown[]]> =
    [];
  const transactionQuery = vi.fn(
    async (...args: [sql: string, values?: readonly unknown[]]) => {
      const [sql] = args;
      queries.push(args);
      if (sql.includes('set_config')) return { rows: [], rowCount: 1 };
      if (sql.includes('FROM public.profiles AS p')) {
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
      if (sql.includes('FROM public.message_templates AS template')) {
        return { rows: [counts], rowCount: 1 };
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

  return { queries, transactionQuery };
}

describe('PostgreSQL template-manager counts repository', () => {
  beforeEach(() => {
    mocks.withTransaction.mockReset();
  });

  it('requires verified account membership before counting templates', async () => {
    const repository = createPostgresTemplateManagerCountsRepository(
      async () => null
    );

    await expect(repository.getForCurrentUser()).rejects.toEqual(
      new AppError('unauthorized')
    );
    expect(mocks.withTransaction).not.toHaveBeenCalled();
  });

  it('returns total and pending counts for the verified user', async () => {
    setupTransactions();
    const repository = createPostgresTemplateManagerCountsRepository(
      async () => sessionA
    );

    await expect(repository.getForCurrentUser()).resolves.toEqual({
      total: 4,
      pending: 2,
    });
  });

  it('returns zero counts for an empty account-user scope', async () => {
    setupTransactions({ counts: { totalCount: '0', pendingCount: '0' } });
    const repository = createPostgresTemplateManagerCountsRepository(
      async () => sessionA
    );

    await expect(repository.getForCurrentUser()).resolves.toEqual({
      total: 0,
      pending: 0,
    });
  });

  it('uses verified account/user scope, creator consistency, pending filter, and transaction-local identity', async () => {
    const { queries } = setupTransactions();
    const repository = createPostgresTemplateManagerCountsRepository(
      async () => sessionA
    );

    await repository.getForCurrentUser();

    const countQuery = queries.find(([sql]) =>
      sql.includes('FROM public.message_templates AS template')
    );
    expect(countQuery?.[0]).toContain('template.account_id = $1');
    expect(countQuery?.[0]).toContain('template.user_id = $2');
    expect(countQuery?.[0]).toContain("template.status = 'PENDING'");
    expect(countQuery?.[0]).toContain('creator.user_id = template.user_id');
    expect(countQuery?.[0]).toContain(
      'creator.account_id = template.account_id'
    );
    expect(countQuery?.[1]).toEqual([accountA, sessionA.userId]);
    expect(countQuery?.[0]).not.toContain('SELECT *');
    expect(
      queries.filter(
        ([sql, values]) =>
          sql === "SELECT set_config('request.jwt.claim.sub', $1, true)" &&
          values?.[0] === sessionA.userId
      )
    ).toHaveLength(2);
  });

  it.each([
    ['negative total', { totalCount: '-1', pendingCount: '0' }],
    ['fractional total', { totalCount: '1.5', pendingCount: '0' }],
    ['unsafe total', { totalCount: '9007199254740992', pendingCount: '0' }],
    ['non-decimal pending count', { totalCount: '2', pendingCount: 'two' }],
    [
      'pending count greater than total',
      { totalCount: '1', pendingCount: '2' },
    ],
  ])('fails closed for %s', async (_label, counts) => {
    setupTransactions({ counts });
    const repository = createPostgresTemplateManagerCountsRepository(
      async () => sessionA
    );

    await expect(repository.getForCurrentUser()).rejects.toEqual(
      new AppError('db_error')
    );
  });

  it('propagates safe database errors without driver details', async () => {
    const databaseFailure = new AppError('db_error');
    mocks.withTransaction
      .mockResolvedValueOnce(
        dbSuccess({
          userId: sessionA.userId,
          accountId: accountA,
          role: 'viewer',
          accountName: 'Synthetic Account A',
        })
      )
      .mockResolvedValueOnce(dbFailure(databaseFailure));
    const repository = createPostgresTemplateManagerCountsRepository(
      async () => sessionA
    );

    await expect(repository.getForCurrentUser()).rejects.toBe(databaseFailure);
  });
});
