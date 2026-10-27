import { describe, expect, it, vi } from 'vitest';
import { AppError, dbFailure, dbSuccess } from '../db/errors';

const mocks = vi.hoisted(() => ({
  transactionQuery: vi.fn(),
  withTransaction: vi.fn(),
}));

vi.mock('server-only', () => ({}));
vi.mock('../db/postgres-client', () => ({
  withTransaction: mocks.withTransaction,
}));

import {
  createPostgresAccountGuards,
  createDefaultPostgresAccountGuards,
  type AccountMembership,
} from './postgres-account-guard';

import type { DbTransaction } from '../db/postgres-client';

const sessionA = { userId: '00000000-0000-4000-8000-000000000001' };
const membershipA: AccountMembership = {
  userId: sessionA.userId,
  accountId: '10000000-0000-4000-8000-000000000001',
  role: 'admin',
  accountName: 'Synthetic Account A',
};

describe('PostgreSQL account guards', () => {
  it('requires a verified session before reading account membership', async () => {
    const findMembership = vi.fn();
    const guards = createPostgresAccountGuards({
      getVerifiedSession: async () => null,
      findMembership,
    });

    await expect(guards.requireAccount()).rejects.toEqual(
      new AppError('unauthorized')
    );
    expect(findMembership).not.toHaveBeenCalled();
  });

  it('derives account context from the verified user membership', async () => {
    const findMembership = vi.fn(async () => dbSuccess(membershipA));
    const guards = createPostgresAccountGuards({
      getVerifiedSession: async () => sessionA,
      findMembership,
    });

    await expect(guards.requireAccount()).resolves.toEqual({
      userId: sessionA.userId,
      accountId: membershipA.accountId,
      role: 'admin',
      account: { id: membershipA.accountId, name: membershipA.accountName },
    });
    expect(findMembership).toHaveBeenCalledExactlyOnceWith(sessionA.userId);
  });

  it('denies a verified user without an account membership', async () => {
    const guards = createPostgresAccountGuards({
      getVerifiedSession: async () => sessionA,
      findMembership: async () => dbSuccess(null),
    });

    await expect(guards.requireAccount()).rejects.toEqual(
      new AppError('forbidden')
    );
  });

  it('denies membership returned for a different user', async () => {
    const guards = createPostgresAccountGuards({
      getVerifiedSession: async () => sessionA,
      findMembership: async () =>
        dbSuccess({
          ...membershipA,
          userId: '00000000-0000-4000-8000-000000000002',
        }),
    });

    await expect(guards.requireAccount()).rejects.toEqual(
      new AppError('forbidden')
    );
  });

  it('denies membership with an unknown role', async () => {
    const guards = createPostgresAccountGuards({
      getVerifiedSession: async () => sessionA,
      findMembership: async () =>
        dbSuccess({ ...membershipA, role: 'superuser' }),
    });

    await expect(guards.requireAccount()).rejects.toEqual(
      new AppError('forbidden')
    );
  });

  it('enforces the existing minimum-role hierarchy', async () => {
    const guards = createPostgresAccountGuards({
      getVerifiedSession: async () => sessionA,
      findMembership: async () => dbSuccess(membershipA),
    });

    await expect(guards.requireRole('admin')).resolves.toMatchObject({
      role: 'admin',
    });
    const roleFailure = await guards.requireRole('owner').then(
      () => {
        throw new Error('Expected owner role requirement to reject.');
      },
      (error: unknown) => error
    );
    expect(roleFailure).toBeInstanceOf(AppError);
    expect(roleFailure).toMatchObject({
      code: 'forbidden',
      reason: 'insufficient_role',
    });
    expect(Object.keys(roleFailure as object)).not.toContain('reason');
  });

  it('preserves database errors instead of treating them as no membership', async () => {
    const databaseFailure = new AppError('db_error');
    const guards = createPostgresAccountGuards({
      getVerifiedSession: async () => sessionA,
      findMembership: async () => dbFailure(databaseFailure),
    });

    await expect(guards.requireAccount()).rejects.toBe(databaseFailure);
  });

  it('queries membership only after resolving a verified user ID', async () => {
    const transactionQuery = vi.fn(async (sql: string) => {
      if (sql.includes('set_config')) {
        return { rows: [], rowCount: 1 };
      }
      return {
        rows: [
          {
            userId: membershipA.userId,
            accountId: membershipA.accountId,
            role: membershipA.role,
            accountName: membershipA.accountName,
          },
        ],
        rowCount: 1,
      };
    });
    const transaction = { query: transactionQuery } as unknown as DbTransaction;
    mocks.withTransaction.mockImplementationOnce(async (operation) => {
      try {
        return dbSuccess(await operation(transaction));
      } catch {
        return dbFailure(new AppError('db_error'));
      }
    });

    const guards = createDefaultPostgresAccountGuards(async () => sessionA);
    await expect(guards.requireAccount()).resolves.toMatchObject({
      userId: sessionA.userId,
      accountId: membershipA.accountId,
    });

    expect(transactionQuery.mock.calls).toEqual([
      [
        "SELECT set_config('request.jwt.claim.sub', $1, true)",
        [sessionA.userId],
      ],
      [expect.stringContaining('WHERE p.user_id = $1'), [sessionA.userId]],
    ]);
    expect(transactionQuery.mock.calls[1]?.[0]).toContain(
      'a.id = p.account_id'
    );
  });
});
