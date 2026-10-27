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
import {
  createPostgresAccountInvitationsRepository,
  type CreateAccountInvitationInput,
} from './account-invitations';

const sessionA = { userId: '00000000-0000-4000-8000-000000000001' };
const accountA = '10000000-0000-4000-8000-000000000001';
const membershipA = {
  userId: sessionA.userId,
  accountId: accountA,
  role: 'admin',
  accountName: 'Synthetic Account A',
};
const input: CreateAccountInvitationInput = {
  role: 'agent',
  tokenHash: 'a'.repeat(64),
  label: 'Synthetic invite',
  expiresAt: new Date('2026-10-25T12:00:00.000Z'),
};
const insertedInvitation = {
  id: '20000000-0000-4000-8000-000000000001',
  role: 'agent',
  label: 'Synthetic invite',
  expires_at: new Date('2026-10-25T12:00:00.000Z'),
  created_at: new Date('2026-10-18T12:00:00.000Z'),
};

function setupTransactions({
  role = 'admin',
  insertRows = [insertedInvitation],
}: {
  role?: string;
  insertRows?: Record<string, unknown>[];
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
      if (sql.includes('INSERT INTO public.account_invitations')) {
        return { rows: insertRows, rowCount: insertRows.length };
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

describe('PostgreSQL account invitation creation repository', () => {
  beforeEach(() => {
    mocks.withTransaction.mockReset();
  });

  it('requires a verified session before opening a transaction', async () => {
    const repository = createPostgresAccountInvitationsRepository(
      async () => null
    );

    await expect(repository.create(input)).rejects.toEqual(
      new AppError('unauthorized')
    );
    expect(mocks.withTransaction).not.toHaveBeenCalled();
  });

  it('requires admin role before issuing an insert', async () => {
    const query = setupTransactions({ role: 'viewer' });
    const repository = createPostgresAccountInvitationsRepository(
      async () => sessionA
    );

    await expect(repository.create(input)).rejects.toEqual(
      new AppError('forbidden')
    );
    expect(
      query.mock.calls.some(([sql]) =>
        sql.includes('INSERT INTO public.account_invitations')
      )
    ).toBe(false);
  });

  it('rejects owner invitations and malformed token hashes before insert', async () => {
    const query = setupTransactions();
    const repository = createPostgresAccountInvitationsRepository(
      async () => sessionA
    );

    await expect(
      repository.create({ ...input, role: 'owner' as never })
    ).rejects.toEqual(new AppError('forbidden'));
    await expect(
      repository.create({ ...input, tokenHash: 'plaintext-token' })
    ).rejects.toEqual(new AppError('forbidden'));
    expect(
      query.mock.calls.some(([sql]) =>
        sql.includes('INSERT INTO public.account_invitations')
      )
    ).toBe(false);
  });

  it('binds caller scope and hash and returns only POST metadata', async () => {
    const query = setupTransactions();
    const repository = createPostgresAccountInvitationsRepository(
      async () => sessionA
    );

    await expect(repository.create(input)).resolves.toEqual({
      id: insertedInvitation.id,
      role: 'agent',
      label: 'Synthetic invite',
      expires_at: '2026-10-25T12:00:00.000Z',
      created_at: '2026-10-18T12:00:00.000Z',
    });

    const insertCall = query.mock.calls.find(([sql]) =>
      sql.includes('INSERT INTO public.account_invitations')
    );
    expect(insertCall?.[0]).toContain('account_id');
    expect(insertCall?.[0]).toContain('token_hash');
    expect(insertCall?.[0]).toContain('created_by_user_id');
    expect(insertCall?.[0]).not.toMatch(/RETURNING[\s\S]*token_hash/i);
    expect(insertCall?.[1]).toEqual([
      accountA,
      input.tokenHash,
      input.role,
      sessionA.userId,
      input.label,
      input.expiresAt,
    ]);
    expect(query.mock.calls.some(([sql]) => sql.includes('set_config'))).toBe(
      true
    );
  });

  it('returns conflict when token hash violates uniqueness', async () => {
    const duplicateError = Object.assign(new Error('duplicate hash'), {
      code: '23505',
    });
    mocks.withTransaction.mockResolvedValueOnce(dbSuccess(membershipA));
    mocks.withTransaction.mockResolvedValueOnce(
      dbFailure(toAppError(duplicateError))
    );
    const repository = createPostgresAccountInvitationsRepository(
      async () => sessionA
    );

    await expect(repository.create(input)).rejects.toEqual(
      new AppError('conflict')
    );
  });

  it('propagates other database failures', async () => {
    const databaseFailure = new AppError('db_error');
    mocks.withTransaction.mockResolvedValueOnce(dbSuccess(membershipA));
    mocks.withTransaction.mockResolvedValueOnce(dbFailure(databaseFailure));
    const repository = createPostgresAccountInvitationsRepository(
      async () => sessionA
    );

    await expect(repository.create(input)).rejects.toBe(databaseFailure);
  });
});
