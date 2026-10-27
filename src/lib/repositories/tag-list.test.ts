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
import { createPostgresTagListRepository } from './tag-list';

const sessionA = { userId: '00000000-0000-4000-8000-000000000001' };
const accountA = '10000000-0000-4000-8000-000000000001';
const tagA = '60000000-0000-4000-8000-000000000001';
const tagRowA = {
  id: tagA,
  user_id: sessionA.userId,
  account_id: accountA,
  name: 'Synthetic tag A',
  color: '#10b981',
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
  tagRows = [tagRowA],
}: {
  role?: string;
  tagRows?: Record<string, unknown>[];
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
      if (sql.includes('FROM public.tags AS t')) {
        return { rows: tagRows, rowCount: tagRows.length };
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

describe('PostgreSQL tag list repository', () => {
  beforeEach(() => {
    mocks.withTransaction.mockReset();
  });

  it('requires a verified session before querying tags', async () => {
    const repository = createPostgresTagListRepository(async () => null);

    await expect(repository.list()).rejects.toEqual(
      new AppError('unauthorized')
    );
    expect(mocks.withTransaction).not.toHaveBeenCalled();
  });

  it('allows viewers and queries the verified account with stable oldest-first order', async () => {
    const query = setupTransactions({
      tagRows: [
        {
          ...tagRowA,
          id: '60000000-0000-4000-8000-000000000002',
          name: 'Synthetic tag B',
        },
        tagRowA,
      ],
    });
    const repository = createPostgresTagListRepository(async () => sessionA);

    await expect(repository.list()).resolves.toEqual([
      {
        id: '60000000-0000-4000-8000-000000000002',
        user_id: sessionA.userId,
        name: 'Synthetic tag B',
        color: '#10b981',
        created_at: '2026-10-18T10:00:00.000Z',
      },
      {
        id: tagA,
        user_id: sessionA.userId,
        name: 'Synthetic tag A',
        color: '#10b981',
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
    expect(sql).toContain('WHERE t.account_id = $1');
    expect(sql).toContain('ORDER BY t.created_at ASC NULLS LAST, t.id ASC');
    expect(values).toEqual([accountA]);
  });

  it('returns an empty array when the account has no tags', async () => {
    setupTransactions({ tagRows: [] });
    const repository = createPostgresTagListRepository(async () => sessionA);

    await expect(repository.list()).resolves.toEqual([]);
  });

  it('rejects malformed or cross-account tag rows safely', async () => {
    setupTransactions({
      tagRows: [
        { ...tagRowA, account_id: '10000000-0000-4000-8000-000000000002' },
      ],
    });
    const repository = createPostgresTagListRepository(async () => sessionA);

    await expect(repository.list()).rejects.toEqual(new AppError('db_error'));

    setupTransactions({ tagRows: [{ ...tagRowA, created_at: null }] });
    await expect(repository.list()).rejects.toEqual(new AppError('db_error'));
  });

  it('propagates safe database errors without exposing driver details', async () => {
    const databaseFailure = new AppError('db_error');
    mocks.withTransaction
      .mockResolvedValueOnce(dbSuccess(membershipA))
      .mockResolvedValueOnce(dbFailure(databaseFailure));
    const repository = createPostgresTagListRepository(async () => sessionA);

    await expect(repository.list()).rejects.toBe(databaseFailure);
  });
});
