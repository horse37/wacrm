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
import { createPostgresAccountMemberRemovalRepository } from './account-member-removal';

const sessionA = { userId: '00000000-0000-4000-8000-00000000000a' };
const accountA = '10000000-0000-4000-8000-000000000001';
const targetA = '00000000-0000-4000-8000-000000000003';
const newAccountId = '20000000-0000-4000-8000-000000000003';
const membershipA = {
  userId: sessionA.userId,
  accountId: accountA,
  role: 'admin',
  accountName: 'Synthetic Account A',
};

function setupTransactions({
  callerRole = 'admin',
  targetRows = [{ role: 'agent' }],
  rpcRows = [{ account_id: newAccountId }],
}: {
  callerRole?: string;
  targetRows?: Record<string, unknown>[];
  rpcRows?: Record<string, unknown>[];
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
      if (sql.includes('public.remove_account_member')) {
        return { rows: rpcRows, rowCount: rpcRows.length };
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

describe('PostgreSQL account member removal repository', () => {
  beforeEach(() => {
    mocks.withTransaction.mockReset();
  });

  it('requires a verified session before opening a transaction', async () => {
    const repository = createPostgresAccountMemberRemovalRepository(
      async () => null
    );

    await expect(repository.removeMember(targetA)).rejects.toEqual(
      new AppError('unauthorized')
    );
    expect(mocks.withTransaction).not.toHaveBeenCalled();
  });

  it.each(['agent', 'viewer'])(
    'requires admin+ before calling the removal RPC for %s callers',
    async (callerRole) => {
      const query = setupTransactions({ callerRole });
      const repository = createPostgresAccountMemberRemovalRepository(
        async () => sessionA
      );

      await expect(repository.removeMember(targetA)).rejects.toEqual(
        new AppError('forbidden')
      );
      expect(
        query.mock.calls.some(([sql]) =>
          sql.includes('public.remove_account_member')
        )
      ).toBe(false);
    }
  );

  it('rejects malformed and self target IDs before the removal RPC', async () => {
    const query = setupTransactions();
    const repository = createPostgresAccountMemberRemovalRepository(
      async () => sessionA
    );

    await expect(repository.removeMember('not-a-uuid')).rejects.toEqual(
      new AppError('forbidden')
    );
    await expect(
      repository.removeMember(sessionA.userId.toUpperCase())
    ).rejects.toEqual(new AppError('forbidden'));
    expect(
      query.mock.calls.some(([sql]) =>
        sql.includes('public.remove_account_member')
      )
    ).toBe(false);
  });

  it('calls the existing RPC with a bound UUID and returns its new account ID', async () => {
    const query = setupTransactions();
    const repository = createPostgresAccountMemberRemovalRepository(
      async () => sessionA
    );

    await expect(repository.removeMember(targetA)).resolves.toBe(newAccountId);

    const targetCall = query.mock.calls.find(([sql]) =>
      sql.includes('FROM public.profiles AS target')
    );
    expect(targetCall?.[0]).toContain('target.user_id = $1');
    expect(targetCall?.[0]).toContain('target.account_id = $2');
    expect(targetCall?.[1]).toEqual([targetA, accountA]);

    const functionCall = query.mock.calls.find(([sql]) =>
      sql.includes('public.remove_account_member')
    );
    expect(functionCall?.[0]).toContain('$1::uuid');
    expect(functionCall?.[1]).toEqual([targetA]);
    expect(query.mock.calls.some(([sql]) => sql.includes('set_config'))).toBe(
      true
    );
  });

  it('hides missing and cross-account targets and refuses owner targets', async () => {
    const query = setupTransactions({ targetRows: [] });
    const repository = createPostgresAccountMemberRemovalRepository(
      async () => sessionA
    );

    await expect(repository.removeMember(targetA)).rejects.toEqual(
      new AppError('not_found')
    );
    expect(
      query.mock.calls.some(([sql]) =>
        sql.includes('public.remove_account_member')
      )
    ).toBe(false);

    mocks.withTransaction.mockReset();
    const ownerQuery = setupTransactions({ targetRows: [{ role: 'owner' }] });
    const ownerRepository = createPostgresAccountMemberRemovalRepository(
      async () => sessionA
    );
    await expect(ownerRepository.removeMember(targetA)).rejects.toEqual(
      new AppError('forbidden')
    );
    expect(
      ownerQuery.mock.calls.some(([sql]) =>
        sql.includes('public.remove_account_member')
      )
    ).toBe(false);
  });

  it('maps database failures and malformed RPC results safely', async () => {
    const databaseFailure = new AppError('db_error');
    mocks.withTransaction.mockResolvedValueOnce(dbSuccess(membershipA));
    mocks.withTransaction.mockResolvedValueOnce(dbFailure(databaseFailure));
    const repository = createPostgresAccountMemberRemovalRepository(
      async () => sessionA
    );

    await expect(repository.removeMember(targetA)).rejects.toBe(
      databaseFailure
    );

    mocks.withTransaction.mockReset();
    setupTransactions({ rpcRows: [{ account_id: 'bad-id' }] });
    const malformedResultRepository =
      createPostgresAccountMemberRemovalRepository(async () => sessionA);
    await expect(
      malformedResultRepository.removeMember(targetA)
    ).rejects.toEqual(new AppError('db_error'));
  });
});
