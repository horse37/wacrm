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
import { createPostgresAccountOwnershipTransferRepository } from './account-ownership-transfer';

const sessionA = { userId: '00000000-0000-4000-8000-000000000001' };
const accountA = '10000000-0000-4000-8000-000000000001';
const targetA = '00000000-0000-4000-8000-000000000003';
const membershipA = {
  userId: sessionA.userId,
  accountId: accountA,
  role: 'owner',
  accountName: 'Synthetic Account A',
};

function setupTransactions({
  callerRole = 'owner',
  targetRows = [{ role: 'agent' }],
}: {
  callerRole?: string;
  targetRows?: Record<string, unknown>[];
} = {}) {
  const transactionQuery = vi.fn(
    async (...args: [sql: string, values?: readonly unknown[]]) => {
      const [sql] = args;
      if (sql.includes('set_config')) return { rows: [], rowCount: 1 };
      if (sql.includes('INNER JOIN public.accounts')) {
        return {
          rows: [{ ...membershipA, role: callerRole }],
          rowCount: 1,
        };
      }
      if (sql.includes('FROM public.profiles AS target')) {
        return { rows: targetRows, rowCount: targetRows.length };
      }
      if (sql.includes('public.transfer_account_ownership')) {
        return { rows: [{ transfer_account_ownership: null }], rowCount: 1 };
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

describe('PostgreSQL account ownership transfer repository', () => {
  beforeEach(() => {
    mocks.withTransaction.mockReset();
  });

  it('requires a verified session before opening a transaction', async () => {
    const repository = createPostgresAccountOwnershipTransferRepository(
      async () => null
    );

    await expect(repository.transferTo(targetA)).rejects.toEqual(
      new AppError('unauthorized')
    );
    expect(mocks.withTransaction).not.toHaveBeenCalled();
  });

  it.each(['admin', 'agent', 'viewer'])(
    'requires an owner before calling the transfer RPC for %s callers',
    async (callerRole) => {
      const query = setupTransactions({ callerRole });
      const repository = createPostgresAccountOwnershipTransferRepository(
        async () => sessionA
      );

      await expect(repository.transferTo(targetA)).rejects.toEqual(
        new AppError('forbidden')
      );
      expect(
        query.mock.calls.some(([sql]) =>
          sql.includes('public.transfer_account_ownership')
        )
      ).toBe(false);
    }
  );

  it('rejects malformed and self target IDs before the transfer RPC', async () => {
    const query = setupTransactions();
    const repository = createPostgresAccountOwnershipTransferRepository(
      async () => sessionA
    );

    await expect(repository.transferTo('not-a-uuid')).rejects.toEqual(
      new AppError('forbidden')
    );
    await expect(
      repository.transferTo(sessionA.userId.toUpperCase())
    ).rejects.toEqual(new AppError('forbidden'));
    expect(
      query.mock.calls.some(([sql]) =>
        sql.includes('public.transfer_account_ownership')
      )
    ).toBe(false);
  });

  it('calls the existing RPC with a bound target UUID after scoped checks', async () => {
    const query = setupTransactions();
    const repository = createPostgresAccountOwnershipTransferRepository(
      async () => sessionA
    );

    await expect(repository.transferTo(targetA)).resolves.toBeUndefined();

    const targetCall = query.mock.calls.find(([sql]) =>
      sql.includes('FROM public.profiles AS target')
    );
    expect(targetCall?.[0]).toContain('target.user_id = $1');
    expect(targetCall?.[0]).toContain('target.account_id = $2');
    expect(targetCall?.[1]).toEqual([targetA, accountA]);

    const functionCall = query.mock.calls.find(([sql]) =>
      sql.includes('public.transfer_account_ownership')
    );
    expect(functionCall?.[0]).toContain('$1::uuid');
    expect(functionCall?.[1]).toEqual([targetA]);
    expect(query.mock.calls.some(([sql]) => sql.includes('set_config'))).toBe(
      true
    );
  });

  it('hides missing and cross-account targets without calling the RPC', async () => {
    const query = setupTransactions({ targetRows: [] });
    const repository = createPostgresAccountOwnershipTransferRepository(
      async () => sessionA
    );

    await expect(repository.transferTo(targetA)).rejects.toEqual(
      new AppError('not_found')
    );
    expect(
      query.mock.calls.some(([sql]) =>
        sql.includes('public.transfer_account_ownership')
      )
    ).toBe(false);
  });

  it('maps database failures safely', async () => {
    const databaseFailure = new AppError('db_error');
    mocks.withTransaction.mockResolvedValueOnce(dbSuccess(membershipA));
    mocks.withTransaction.mockResolvedValueOnce(dbFailure(databaseFailure));
    const repository = createPostgresAccountOwnershipTransferRepository(
      async () => sessionA
    );

    await expect(repository.transferTo(targetA)).rejects.toBe(databaseFailure);
  });
});
