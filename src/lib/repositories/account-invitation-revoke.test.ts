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
import { createPostgresAccountInvitationsRepository } from './account-invitations';

const sessionA = { userId: '00000000-0000-4000-8000-000000000001' };
const accountA = '10000000-0000-4000-8000-000000000001';
const invitationId = '20000000-0000-4000-8000-000000000001';
const membershipA = {
  userId: sessionA.userId,
  accountId: accountA,
  role: 'admin',
  accountName: 'Synthetic Account A',
};

function setupTransactions({
  role = 'admin',
  deletedRows = [{ id: invitationId }],
}: {
  role?: string;
  deletedRows?: Record<string, unknown>[];
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
      if (sql.includes('DELETE FROM public.account_invitations')) {
        return { rows: deletedRows, rowCount: deletedRows.length };
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

describe('PostgreSQL account invitation revocation repository', () => {
  beforeEach(() => {
    mocks.withTransaction.mockReset();
  });

  it('requires a verified session before opening a transaction', async () => {
    const repository = createPostgresAccountInvitationsRepository(
      async () => null
    );

    await expect(repository.revoke(invitationId)).rejects.toEqual(
      new AppError('unauthorized')
    );
    expect(mocks.withTransaction).not.toHaveBeenCalled();
  });

  it.each(['agent', 'viewer'])(
    'denies %s callers before deleting invitations',
    async (role) => {
      const query = setupTransactions({ role });
      const repository = createPostgresAccountInvitationsRepository(
        async () => sessionA
      );

      await expect(repository.revoke(invitationId)).rejects.toEqual(
        new AppError('forbidden')
      );
      expect(
        query.mock.calls.some(([sql]) =>
          sql.includes('DELETE FROM public.account_invitations')
        )
      ).toBe(false);
    }
  );

  it('deletes only the invitation visible in the guarded account', async () => {
    const query = setupTransactions();
    const repository = createPostgresAccountInvitationsRepository(
      async () => sessionA
    );

    await expect(repository.revoke(invitationId)).resolves.toBe(true);

    const deleteCall = query.mock.calls.find(([sql]) =>
      sql.includes('DELETE FROM public.account_invitations')
    );
    expect(deleteCall?.[0]).toContain('invitation.id = $1');
    expect(deleteCall?.[0]).toContain('invitation.account_id = $2');
    expect(deleteCall?.[0]).toContain('RETURNING invitation.id');
    expect(deleteCall?.[1]).toEqual([invitationId, accountA]);
    expect(query.mock.calls.some(([sql]) => sql.includes('set_config'))).toBe(
      true
    );
  });

  it('returns false for missing or cross-account invitation IDs', async () => {
    setupTransactions({ deletedRows: [] });
    const repository = createPostgresAccountInvitationsRepository(
      async () => sessionA
    );

    await expect(repository.revoke(invitationId)).resolves.toBe(false);
  });

  it('propagates database failures', async () => {
    const databaseFailure = new AppError('db_error');
    mocks.withTransaction.mockResolvedValueOnce(dbSuccess(membershipA));
    mocks.withTransaction.mockResolvedValueOnce(dbFailure(databaseFailure));
    const repository = createPostgresAccountInvitationsRepository(
      async () => sessionA
    );

    await expect(repository.revoke(invitationId)).rejects.toBe(databaseFailure);
  });
});
