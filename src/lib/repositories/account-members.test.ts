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
import { createPostgresAccountMembersRepository } from './account-members';

const sessionA = { userId: '00000000-0000-4000-8000-000000000001' };
const accountA = '10000000-0000-4000-8000-000000000001';
const membershipAdmin = {
  userId: sessionA.userId,
  accountId: accountA,
  role: 'admin',
  accountName: 'Synthetic Account A',
};

function setupTransactions({
  role = 'admin',
  callerRole = role,
  memberRows = [],
}: {
  role?: string;
  callerRole?: string;
  memberRows?: Record<string, unknown>[];
} = {}) {
  const transactionQuery = vi.fn(
    async (...args: [sql: string, values?: readonly unknown[]]) => {
      const [sql] = args;
      if (sql.includes('set_config')) return { rows: [], rowCount: 1 };
      if (sql.includes('INNER JOIN public.accounts')) {
        return {
          rows: [{ ...membershipAdmin, role }],
          rowCount: 1,
        };
      }
      if (sql.includes('WHERE p.account_id = $1')) {
        return {
          rows: memberRows.map((member) => ({
            ...member,
            caller_role: callerRole,
          })),
          rowCount: memberRows.length,
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

describe('PostgreSQL account members repository', () => {
  beforeEach(() => {
    mocks.withTransaction.mockReset();
  });

  it('requires a verified session before opening a database transaction', async () => {
    const repository = createPostgresAccountMembersRepository(async () => null);

    await expect(repository.list()).rejects.toEqual(
      new AppError('unauthorized')
    );
    expect(mocks.withTransaction).not.toHaveBeenCalled();
  });

  it('binds RLS identity and the account scope from the verified session guard', async () => {
    const query = setupTransactions({
      memberRows: [
        {
          user_id: sessionA.userId,
          full_name: 'Synthetic Admin',
          email: 'admin@example.test',
          avatar_url: null,
          role: 'admin',
          joined_at: new Date('2026-10-19T12:00:00.000Z'),
        },
      ],
    });
    const repository = createPostgresAccountMembersRepository(
      async () => sessionA
    );

    await expect(repository.list()).resolves.toEqual([
      {
        user_id: sessionA.userId,
        full_name: 'Synthetic Admin',
        email: 'admin@example.test',
        avatar_url: null,
        role: 'admin',
        joined_at: '2026-10-19T12:00:00.000Z',
      },
    ]);

    expect(query.mock.calls[0]).toEqual([
      "SELECT set_config('request.jwt.claim.sub', $1, true)",
      [sessionA.userId],
    ]);
    expect(query.mock.calls[1]?.[1]).toEqual([sessionA.userId]);
    expect(query.mock.calls[2]).toEqual([
      "SELECT set_config('request.jwt.claim.sub', $1, true)",
      [sessionA.userId],
    ]);
    expect(query.mock.calls[3]?.[0]).toContain('WHERE p.account_id = $1');
    expect(query.mock.calls[3]?.[1]).toEqual([accountA, sessionA.userId]);
    expect(query.mock.calls[3]?.[0]).toContain(
      'ORDER BY p.created_at ASC NULLS LAST, p.user_id ASC'
    );
  });

  it('hides email from agent and viewer roles and skips unknown roles', async () => {
    const query = setupTransactions({
      role: 'agent',
      memberRows: [
        {
          user_id: sessionA.userId,
          full_name: 'Synthetic Agent',
          email: 'agent@example.test',
          avatar_url: null,
          role: 'agent',
          joined_at: new Date('2026-10-19T12:00:00.000Z'),
        },
        {
          user_id: '00000000-0000-4000-8000-000000000099',
          full_name: 'Synthetic Unknown',
          email: 'unknown@example.test',
          avatar_url: null,
          role: 'unexpected',
          joined_at: new Date('2026-10-19T13:00:00.000Z'),
        },
      ],
    });
    const repository = createPostgresAccountMembersRepository(
      async () => sessionA
    );

    await expect(repository.list()).resolves.toEqual([
      {
        user_id: sessionA.userId,
        full_name: 'Synthetic Agent',
        email: null,
        avatar_url: null,
        role: 'agent',
        joined_at: '2026-10-19T12:00:00.000Z',
      },
    ]);
    expect(query).toHaveBeenCalledTimes(4);
  });

  it('uses the caller role from the member-list query for email visibility', async () => {
    setupTransactions({
      role: 'admin',
      callerRole: 'viewer',
      memberRows: [
        {
          user_id: sessionA.userId,
          full_name: 'Synthetic Admin Downgraded',
          email: 'admin@example.test',
          avatar_url: null,
          role: 'admin',
          joined_at: new Date('2026-10-19T12:00:00.000Z'),
        },
      ],
    });
    const repository = createPostgresAccountMembersRepository(
      async () => sessionA
    );

    await expect(repository.list()).resolves.toMatchObject([
      { user_id: sessionA.userId, email: null },
    ]);
  });

  it('propagates transaction failures', async () => {
    const databaseFailure = new AppError('db_error');
    mocks.withTransaction.mockResolvedValueOnce(dbSuccess(membershipAdmin));
    mocks.withTransaction.mockResolvedValueOnce(dbFailure(databaseFailure));
    const repository = createPostgresAccountMembersRepository(
      async () => sessionA
    );

    await expect(repository.list()).rejects.toBe(databaseFailure);
  });
});
