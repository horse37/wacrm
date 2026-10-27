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
import { createPostgresAccountMemberRoleRepository } from './account-member-role';

const sessionA = { userId: '00000000-0000-4000-8000-00000000000a' };
const accountA = '10000000-0000-4000-8000-000000000001';
const targetA = '00000000-0000-4000-8000-000000000003';
const membershipA = {
  userId: sessionA.userId,
  accountId: accountA,
  role: 'admin',
  accountName: 'Synthetic Account A',
};

function setupTransactions({
  callerRole = 'admin',
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
      if (sql.includes('FROM public.profiles AS caller')) {
        return { rows: [{ role: callerRole }], rowCount: 1 };
      }
      if (sql.includes('FROM public.profiles AS target')) {
        return { rows: targetRows, rowCount: targetRows.length };
      }
      if (sql.includes('public.set_member_role')) {
        return { rows: [{ set_member_role: '' }], rowCount: 1 };
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

describe('PostgreSQL account member role repository', () => {
  beforeEach(() => {
    mocks.withTransaction.mockReset();
  });

  it('requires a verified session before opening a transaction', async () => {
    const repository = createPostgresAccountMemberRoleRepository(
      async () => null
    );

    await expect(repository.setRole(targetA, 'viewer')).rejects.toEqual(
      new AppError('unauthorized')
    );
    expect(mocks.withTransaction).not.toHaveBeenCalled();
  });

  it.each(['agent', 'viewer'])(
    'requires admin+ before calling the role function for %s callers',
    async (callerRole) => {
      const query = setupTransactions({ callerRole });
      const repository = createPostgresAccountMemberRoleRepository(
        async () => sessionA
      );

      await expect(repository.setRole(targetA, 'viewer')).rejects.toEqual(
        new AppError('forbidden')
      );
      expect(
        query.mock.calls.some(([sql]) => sql.includes('public.set_member_role'))
      ).toBe(false);
    }
  );

  it('rejects self changes and owner or invalid target roles', async () => {
    const query = setupTransactions();
    const repository = createPostgresAccountMemberRoleRepository(
      async () => sessionA
    );

    await expect(repository.setRole(sessionA.userId, 'viewer')).rejects.toEqual(
      new AppError('forbidden')
    );
    await expect(repository.setRole(targetA, 'owner' as never)).rejects.toEqual(
      new AppError('forbidden')
    );
    await expect(
      repository.setRole(targetA, 'superuser' as never)
    ).rejects.toEqual(new AppError('forbidden'));
    expect(
      query.mock.calls.some(([sql]) => sql.includes('public.set_member_role'))
    ).toBe(false);
  });

  it('rejects a self ID with uppercase UUID hex before the RPC', async () => {
    const query = setupTransactions();
    const repository = createPostgresAccountMemberRoleRepository(
      async () => sessionA
    );

    await expect(
      repository.setRole(sessionA.userId.toUpperCase(), 'viewer')
    ).rejects.toEqual(new AppError('forbidden'));
    expect(
      query.mock.calls.some(([sql]) => sql.includes('public.set_member_role'))
    ).toBe(false);
  });

  it('calls the existing RPC with bound target and role after scoped checks', async () => {
    const query = setupTransactions();
    const repository = createPostgresAccountMemberRoleRepository(
      async () => sessionA
    );

    await expect(
      repository.setRole(targetA, 'viewer')
    ).resolves.toBeUndefined();

    const targetCall = query.mock.calls.find(([sql]) =>
      sql.includes('FROM public.profiles AS target')
    );
    expect(targetCall?.[0]).toContain('target.user_id = $1');
    expect(targetCall?.[0]).toContain('target.account_id = $2');
    expect(targetCall?.[1]).toEqual([targetA, accountA]);

    const functionCall = query.mock.calls.find(([sql]) =>
      sql.includes('public.set_member_role')
    );
    expect(functionCall?.[0]).toContain('$1::uuid');
    expect(functionCall?.[0]).toContain('$2::public.account_role_enum');
    expect(functionCall?.[1]).toEqual([targetA, 'viewer']);
    expect(query.mock.calls.some(([sql]) => sql.includes('set_config'))).toBe(
      true
    );
  });

  it('hides missing and cross-account targets and refuses owner targets', async () => {
    const query = setupTransactions({ targetRows: [] });
    const repository = createPostgresAccountMemberRoleRepository(
      async () => sessionA
    );

    await expect(repository.setRole(targetA, 'viewer')).rejects.toEqual(
      new AppError('not_found')
    );
    expect(
      query.mock.calls.some(([sql]) => sql.includes('public.set_member_role'))
    ).toBe(false);

    mocks.withTransaction.mockReset();
    const ownerQuery = setupTransactions({ targetRows: [{ role: 'owner' }] });
    const ownerRepository = createPostgresAccountMemberRoleRepository(
      async () => sessionA
    );
    await expect(ownerRepository.setRole(targetA, 'viewer')).rejects.toEqual(
      new AppError('forbidden')
    );
    expect(
      ownerQuery.mock.calls.some(([sql]) =>
        sql.includes('public.set_member_role')
      )
    ).toBe(false);
  });

  it('maps database failures to the safe database error', async () => {
    const databaseFailure = new AppError('db_error');
    mocks.withTransaction.mockResolvedValueOnce(dbSuccess(membershipA));
    mocks.withTransaction.mockResolvedValueOnce(dbFailure(databaseFailure));
    const repository = createPostgresAccountMemberRoleRepository(
      async () => sessionA
    );

    await expect(repository.setRole(targetA, 'viewer')).rejects.toBe(
      databaseFailure
    );
  });
});
