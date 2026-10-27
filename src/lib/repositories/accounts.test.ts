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
import { createPostgresAccountRepository } from './accounts';

const sessionA = { userId: '00000000-0000-4000-8000-000000000001' };
const accountA = '10000000-0000-4000-8000-000000000001';
const membershipA = {
  userId: sessionA.userId,
  accountId: accountA,
  role: 'admin',
  accountName: 'Synthetic Account A',
};

function setupTransactions({
  role = 'admin',
  updateRows = [{ id: accountA, name: 'Renamed Account A' }],
}: {
  role?: string;
  updateRows?: Record<string, unknown>[];
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
      if (sql.includes('UPDATE public.accounts')) {
        return { rows: updateRows, rowCount: updateRows.length };
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

describe('PostgreSQL account repository', () => {
  beforeEach(() => {
    mocks.withTransaction.mockReset();
  });

  it('requires a verified session before opening a transaction', async () => {
    const repository = createPostgresAccountRepository(async () => null);

    await expect(repository.rename('Renamed Account A')).rejects.toEqual(
      new AppError('unauthorized')
    );
    expect(mocks.withTransaction).not.toHaveBeenCalled();
  });

  it('requires admin role and updates only the account from verified membership', async () => {
    const query = setupTransactions();
    const repository = createPostgresAccountRepository(async () => sessionA);

    await expect(repository.rename('Renamed Account A')).resolves.toEqual({
      id: accountA,
      name: 'Renamed Account A',
    });

    expect(query.mock.calls[0]).toEqual([
      "SELECT set_config('request.jwt.claim.sub', $1, true)",
      [sessionA.userId],
    ]);
    expect(query.mock.calls[2]).toEqual([
      "SELECT set_config('request.jwt.claim.sub', $1, true)",
      [sessionA.userId],
    ]);
    expect(query.mock.calls[3]?.[0]).toContain('WHERE a.id = $2');
    expect(query.mock.calls[3]?.[0]).toContain(
      'RETURNING a.id::text AS id, a.name'
    );
    expect(query.mock.calls[3]?.[1]).toEqual(['Renamed Account A', accountA]);
  });

  it.each(['agent', 'viewer'])(
    'denies %s before issuing an account update',
    async (role) => {
      const query = setupTransactions({ role });
      const repository = createPostgresAccountRepository(async () => sessionA);

      await expect(repository.rename('Renamed Account A')).rejects.toEqual(
        new AppError('forbidden')
      );
      expect(query.mock.calls.some(([sql]) => sql.includes('UPDATE'))).toBe(
        false
      );
    }
  );

  it('returns not_found when RLS or concurrent deletion leaves no updated row', async () => {
    setupTransactions({ updateRows: [] });
    const repository = createPostgresAccountRepository(async () => sessionA);

    await expect(repository.rename('Renamed Account A')).rejects.toEqual(
      new AppError('not_found')
    );
  });

  it('propagates database failures', async () => {
    const databaseFailure = new AppError('db_error');
    mocks.withTransaction.mockResolvedValueOnce(dbSuccess(membershipA));
    mocks.withTransaction.mockResolvedValueOnce(dbFailure(databaseFailure));
    const repository = createPostgresAccountRepository(async () => sessionA);

    await expect(repository.rename('Renamed Account A')).rejects.toBe(
      databaseFailure
    );
  });
});
