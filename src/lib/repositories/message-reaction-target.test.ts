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
import { createPostgresMessageReactionTargetRepository } from './message-reaction-target';

const sessionA = { userId: '00000000-0000-4000-8000-000000000003' };
const accountA = '10000000-0000-4000-8000-000000000001';
const messageA = '30000000-0000-4000-8000-000000000001';
const membershipA = {
  userId: sessionA.userId,
  accountId: accountA,
  role: 'agent',
  accountName: 'Synthetic Account A',
};
const targetA = {
  providerMessageId: 'SYNTHETIC_PROVIDER_MESSAGE_A',
  contactPhone: '+15555550123',
};

function setupTransactions({
  role = 'agent',
  targetRows = [targetA],
}: {
  role?: string;
  targetRows?: Record<string, unknown>[];
} = {}) {
  const transactionQuery = vi.fn(
    async (...args: [sql: string, values?: readonly unknown[]]) => {
      const [sql] = args;
      if (sql.includes('set_config')) return { rows: [], rowCount: 1 };
      if (sql.includes('INNER JOIN public.accounts')) {
        return { rows: [{ ...membershipA, role }], rowCount: 1 };
      }
      if (sql.includes('FROM public.messages AS message')) {
        return { rows: targetRows, rowCount: targetRows.length };
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

describe('PostgreSQL message-reaction target repository', () => {
  beforeEach(() => {
    mocks.withTransaction.mockReset();
  });

  it('requires a verified session before opening a target transaction', async () => {
    const repository = createPostgresMessageReactionTargetRepository(
      async () => null
    );

    await expect(repository.getTarget(messageA)).rejects.toEqual(
      new AppError('unauthorized')
    );
    expect(mocks.withTransaction).not.toHaveBeenCalled();
  });

  it('denies a caller below agent role before reading the target', async () => {
    const query = setupTransactions({ role: 'viewer' });
    const repository = createPostgresMessageReactionTargetRepository(
      async () => sessionA
    );

    await expect(repository.getTarget(messageA)).rejects.toEqual(
      new AppError('forbidden')
    );
    expect(
      query.mock.calls.some(([sql]) =>
        sql.includes('FROM public.messages AS message')
      )
    ).toBe(false);
  });

  it('validates the internal message UUID before issuing target SQL', async () => {
    const query = setupTransactions();
    const repository = createPostgresMessageReactionTargetRepository(
      async () => sessionA
    );

    await expect(repository.getTarget('../invalid-message-id')).rejects.toEqual(
      new AppError('bad_request')
    );
    expect(
      query.mock.calls.some(([sql]) =>
        sql.includes('FROM public.messages AS message')
      )
    ).toBe(false);
  });

  it('returns only the provider message ID and contact phone for its account', async () => {
    const query = setupTransactions();
    const repository = createPostgresMessageReactionTargetRepository(
      async () => sessionA
    );

    await expect(repository.getTarget(messageA)).resolves.toEqual(targetA);

    const identityIndex = query.mock.calls.findIndex(([sql]) =>
      sql.includes('set_config')
    );
    const targetIndex = query.mock.calls.findIndex(([sql]) =>
      sql.includes('FROM public.messages AS message')
    );
    expect(identityIndex).toBeGreaterThanOrEqual(0);
    expect(targetIndex).toBeGreaterThan(identityIndex);
    const [sql, values] = query.mock.calls[targetIndex] ?? [];
    expect(sql).toContain('conversation.account_id = $2');
    expect(sql).toContain('contact.account_id = conversation.account_id');
    expect(sql).toContain('conversation.account_id = $2');
    expect(sql).not.toContain('public.profiles AS creator');
    expect(sql).not.toMatch(
      /access_token|verify_token|waba_id|phone_number_id/i
    );
    expect(values).toEqual([messageA, accountA]);
  });

  it('returns not found for a missing or cross-account message', async () => {
    setupTransactions({ targetRows: [] });
    const repository = createPostgresMessageReactionTargetRepository(
      async () => sessionA
    );

    await expect(repository.getTarget(messageA)).rejects.toEqual(
      new AppError('not_found')
    );
  });

  it('returns a target without a provider message ID for an unsent message', async () => {
    setupTransactions({
      targetRows: [
        { providerMessageId: null, contactPhone: targetA.contactPhone },
      ],
    });
    const repository = createPostgresMessageReactionTargetRepository(
      async () => sessionA
    );

    await expect(repository.getTarget(messageA)).resolves.toEqual({
      providerMessageId: null,
      contactPhone: targetA.contactPhone,
    });
  });

  it.each([null, '', '   '])(
    'returns a target without a usable contact phone (%s)',
    async (contactPhone) => {
      setupTransactions({
        targetRows: [
          {
            providerMessageId: targetA.providerMessageId,
            contactPhone,
          },
        ],
      });
      const repository = createPostgresMessageReactionTargetRepository(
        async () => sessionA
      );

      await expect(repository.getTarget(messageA)).resolves.toEqual({
        providerMessageId: targetA.providerMessageId,
        contactPhone: null,
      });
    }
  );

  it('fails safely if target joins produce multiple rows', async () => {
    setupTransactions({ targetRows: [targetA, targetA] });
    const repository = createPostgresMessageReactionTargetRepository(
      async () => sessionA
    );

    await expect(repository.getTarget(messageA)).rejects.toEqual(
      new AppError('conflict')
    );
  });

  it('propagates safe database errors without driver details', async () => {
    const databaseFailure = new AppError('db_error');
    mocks.withTransaction
      .mockResolvedValueOnce(dbSuccess(membershipA))
      .mockResolvedValueOnce(dbFailure(databaseFailure));
    const repository = createPostgresMessageReactionTargetRepository(
      async () => sessionA
    );

    await expect(repository.getTarget(messageA)).rejects.toBe(databaseFailure);
  });
});
