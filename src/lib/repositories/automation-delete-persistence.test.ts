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
import { createPostgresAutomationDeletePersistenceRepository } from './automation-delete-persistence';

const sessionA = { userId: '00000000-0000-4000-8000-000000000003' };
const accountA = '10000000-0000-4000-8000-000000000001';
const automationA = '70000000-0000-4000-8000-000000000001';
const membershipA = {
  userId: sessionA.userId,
  accountId: accountA,
  role: 'agent',
  accountName: 'Synthetic Account A',
};

function setupTransactions({
  role = 'agent',
  deletedRows = [{ id: automationA }],
}: {
  role?: string;
  deletedRows?: Record<string, unknown>[];
} = {}) {
  const transactionQuery = vi.fn(
    async (...args: [sql: string, values?: readonly unknown[]]) => {
      const [sql] = args;
      if (sql.includes('set_config')) return { rows: [], rowCount: 1 };
      if (sql.includes('INNER JOIN public.accounts')) {
        return { rows: [{ ...membershipA, role }], rowCount: 1 };
      }
      if (sql.includes('DELETE FROM public.automations AS automation')) {
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

describe('PostgreSQL automation-delete persistence repository', () => {
  beforeEach(() => {
    mocks.withTransaction.mockReset();
  });

  it('requires a verified session before opening a delete transaction', async () => {
    const repository = createPostgresAutomationDeletePersistenceRepository(
      async () => null
    );

    await expect(repository.deleteOwnedAutomation(automationA)).rejects.toEqual(
      new AppError('unauthorized')
    );
    expect(mocks.withTransaction).not.toHaveBeenCalled();
  });

  it('denies viewers before the delete query', async () => {
    const query = setupTransactions({ role: 'viewer' });
    const repository = createPostgresAutomationDeletePersistenceRepository(
      async () => sessionA
    );

    await expect(repository.deleteOwnedAutomation(automationA)).rejects.toEqual(
      new AppError('forbidden')
    );
    expect(
      query.mock.calls.some(([sql]) =>
        sql.includes('DELETE FROM public.automations AS automation')
      )
    ).toBe(false);
  });

  it('validates the automation UUID before issuing delete SQL', async () => {
    const query = setupTransactions();
    const repository = createPostgresAutomationDeletePersistenceRepository(
      async () => sessionA
    );

    await expect(
      repository.deleteOwnedAutomation('not-an-automation-id')
    ).rejects.toEqual(new AppError('bad_request'));
    expect(
      query.mock.calls.some(([sql]) =>
        sql.includes('DELETE FROM public.automations AS automation')
      )
    ).toBe(false);
  });

  it('deletes only the requested automation owned by the verified account member', async () => {
    const query = setupTransactions();
    const repository = createPostgresAutomationDeletePersistenceRepository(
      async () => sessionA
    );

    await expect(
      repository.deleteOwnedAutomation(automationA)
    ).resolves.toBeUndefined();

    const deletion = query.mock.calls.find(([sql]) =>
      sql.includes('DELETE FROM public.automations AS automation')
    );
    expect(deletion?.[0]).toContain('automation.id = $1');
    expect(deletion?.[0]).toContain('automation.user_id = $2');
    expect(deletion?.[0]).toContain('automation.account_id = $3');
    expect(deletion?.[0]).toContain('profile.user_id = automation.user_id');
    expect(deletion?.[0]).toContain(
      'profile.account_id = automation.account_id'
    );
    expect(deletion?.[0]).toContain('RETURNING automation.id::text AS id');
    expect(deletion?.[1]).toEqual([automationA, sessionA.userId, accountA]);
    expect(
      query.mock.calls.some(
        ([sql, values]) =>
          sql === "SELECT set_config('request.jwt.claim.sub', $1, true)" &&
          values?.[0] === sessionA.userId
      )
    ).toBe(true);
  });

  it('returns not found for missing, non-owned, or cross-account automations', async () => {
    setupTransactions({ deletedRows: [] });
    const repository = createPostgresAutomationDeletePersistenceRepository(
      async () => sessionA
    );

    await expect(repository.deleteOwnedAutomation(automationA)).rejects.toEqual(
      new AppError('not_found')
    );
  });

  it('fails closed if deletion affects multiple automations or returns a wrong ID', async () => {
    setupTransactions({
      deletedRows: [{ id: automationA }, { id: automationA }],
    });
    const duplicateRepository =
      createPostgresAutomationDeletePersistenceRepository(async () => sessionA);
    await expect(
      duplicateRepository.deleteOwnedAutomation(automationA)
    ).rejects.toEqual(new AppError('conflict'));

    setupTransactions({
      deletedRows: [{ id: '70000000-0000-4000-8000-000000000002' }],
    });
    const wrongIdRepository =
      createPostgresAutomationDeletePersistenceRepository(async () => sessionA);
    await expect(
      wrongIdRepository.deleteOwnedAutomation(automationA)
    ).rejects.toEqual(new AppError('db_error'));
  });

  it('propagates safe database errors without driver details', async () => {
    const databaseFailure = new AppError('db_error');
    mocks.withTransaction
      .mockResolvedValueOnce(dbSuccess(membershipA))
      .mockResolvedValueOnce(dbFailure(databaseFailure));
    const repository = createPostgresAutomationDeletePersistenceRepository(
      async () => sessionA
    );

    await expect(repository.deleteOwnedAutomation(automationA)).rejects.toBe(
      databaseFailure
    );
  });
});
