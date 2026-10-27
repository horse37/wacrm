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
const membershipA = {
  userId: sessionA.userId,
  accountId: accountA,
  role: 'admin',
  accountName: 'Synthetic Account A',
};

const invitationA = {
  id: '20000000-0000-4000-8000-000000000001',
  role: 'agent',
  label: 'Synthetic invitation A',
  created_by_user_id: sessionA.userId,
  created_at: new Date('2026-10-18T12:00:00.000Z'),
  expires_at: new Date('2026-10-25T12:00:00.000Z'),
  accepted_at: null,
  accepted_by_user_id: null,
};

function setupTransactions({
  role = 'admin',
  invitationRows = [invitationA],
}: {
  role?: string;
  invitationRows?: Record<string, unknown>[];
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
      if (sql.includes('FROM public.account_invitations AS invitation')) {
        return { rows: invitationRows, rowCount: invitationRows.length };
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

describe('PostgreSQL account invitations repository', () => {
  beforeEach(() => {
    mocks.withTransaction.mockReset();
  });

  it('requires a verified session before opening a transaction', async () => {
    const repository = createPostgresAccountInvitationsRepository(
      async () => null
    );

    await expect(repository.listOutstanding()).rejects.toEqual(
      new AppError('unauthorized')
    );
    expect(mocks.withTransaction).not.toHaveBeenCalled();
  });

  it.each(['owner', 'admin'])(
    'lists only the guarded account invitations for %s callers',
    async (role) => {
      const query = setupTransactions({ role });
      const repository = createPostgresAccountInvitationsRepository(
        async () => sessionA
      );

      await expect(repository.listOutstanding()).resolves.toEqual([
        {
          ...invitationA,
          created_at: '2026-10-18T12:00:00.000Z',
          expires_at: '2026-10-25T12:00:00.000Z',
        },
      ]);

      const invitationCall = query.mock.calls.find(([sql]) =>
        sql.includes('FROM public.account_invitations AS invitation')
      );
      expect(invitationCall?.[1]).toEqual([accountA]);
      expect(invitationCall?.[0]).toContain('invitation.account_id = $1');
      expect(invitationCall?.[0]).toContain('invitation.accepted_at IS NULL');
      expect(invitationCall?.[0]).toContain(
        'invitation.expires_at > CURRENT_TIMESTAMP'
      );
      expect(invitationCall?.[0]).toContain(
        'ORDER BY invitation.created_at DESC, invitation.id DESC'
      );
      expect(invitationCall?.[0]).not.toMatch(/token_hash/i);
      expect(query.mock.calls.some(([sql]) => sql.includes('set_config'))).toBe(
        true
      );
    }
  );

  it.each(['agent', 'viewer'])(
    'denies %s callers before querying invitations',
    async (role) => {
      const query = setupTransactions({ role });
      const repository = createPostgresAccountInvitationsRepository(
        async () => sessionA
      );

      await expect(repository.listOutstanding()).rejects.toEqual(
        new AppError('forbidden')
      );
      expect(
        query.mock.calls.some(([sql]) =>
          sql.includes('FROM public.account_invitations AS invitation')
        )
      ).toBe(false);
    }
  );

  it('returns an empty list when account has no outstanding invitations', async () => {
    setupTransactions({ invitationRows: [] });
    const repository = createPostgresAccountInvitationsRepository(
      async () => sessionA
    );

    await expect(repository.listOutstanding()).resolves.toEqual([]);
  });

  it('propagates database failures', async () => {
    const databaseFailure = new AppError('db_error');
    mocks.withTransaction.mockResolvedValueOnce(dbSuccess(membershipA));
    mocks.withTransaction.mockResolvedValueOnce(dbFailure(databaseFailure));
    const repository = createPostgresAccountInvitationsRepository(
      async () => sessionA
    );

    await expect(repository.listOutstanding()).rejects.toBe(databaseFailure);
  });
});
