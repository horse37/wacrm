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
import { createPostgresFlowDeletePersistenceRepository } from './flow-delete-persistence';

const sessionA = { userId: '00000000-0000-4000-8000-000000000003' };
const accountA = '10000000-0000-4000-8000-000000000001';
const flowA = '70000000-0000-4000-8000-000000000001';
const membershipA = {
  userId: sessionA.userId,
  accountId: accountA,
  role: 'agent',
  accountName: 'Synthetic Account A',
};

function setupTransactions({
  role = 'agent',
  deletedRows = [{ id: flowA }],
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
      if (sql.includes('DELETE FROM public.flows AS flow')) {
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

describe('PostgreSQL flow-delete persistence repository', () => {
  beforeEach(() => {
    mocks.withTransaction.mockReset();
  });

  it('requires a verified session before opening a delete transaction', async () => {
    const repository = createPostgresFlowDeletePersistenceRepository(
      async () => null
    );

    await expect(repository.deleteOwnedFlow(flowA)).rejects.toEqual(
      new AppError('unauthorized')
    );
    expect(mocks.withTransaction).not.toHaveBeenCalled();
  });

  it('denies viewers before the delete query', async () => {
    const query = setupTransactions({ role: 'viewer' });
    const repository = createPostgresFlowDeletePersistenceRepository(
      async () => sessionA
    );

    await expect(repository.deleteOwnedFlow(flowA)).rejects.toEqual(
      new AppError('forbidden')
    );
    expect(
      query.mock.calls.some(([sql]) =>
        sql.includes('DELETE FROM public.flows AS flow')
      )
    ).toBe(false);
  });

  it('validates the flow UUID before issuing delete SQL', async () => {
    const query = setupTransactions();
    const repository = createPostgresFlowDeletePersistenceRepository(
      async () => sessionA
    );

    await expect(repository.deleteOwnedFlow('not-a-flow-id')).rejects.toEqual(
      new AppError('bad_request')
    );
    expect(
      query.mock.calls.some(([sql]) =>
        sql.includes('DELETE FROM public.flows AS flow')
      )
    ).toBe(false);
  });

  it('deletes only the requested flow owned by the verified account member', async () => {
    const query = setupTransactions();
    const repository = createPostgresFlowDeletePersistenceRepository(
      async () => sessionA
    );

    await expect(repository.deleteOwnedFlow(flowA)).resolves.toBeUndefined();

    const deletion = query.mock.calls.find(([sql]) =>
      sql.includes('DELETE FROM public.flows AS flow')
    );
    expect(deletion?.[0]).toContain('flow.id = $1');
    expect(deletion?.[0]).toContain('flow.user_id = $2');
    expect(deletion?.[0]).toContain('flow.account_id = $3');
    expect(deletion?.[0]).toContain('RETURNING flow.id::text AS id');
    expect(deletion?.[1]).toEqual([flowA, sessionA.userId, accountA]);
    expect(
      query.mock.calls.some(
        ([sql, values]) =>
          sql === "SELECT set_config('request.jwt.claim.sub', $1, true)" &&
          values?.[0] === sessionA.userId
      )
    ).toBe(true);
  });

  it('returns not found for missing, non-owned, or cross-account flows', async () => {
    setupTransactions({ deletedRows: [] });
    const repository = createPostgresFlowDeletePersistenceRepository(
      async () => sessionA
    );

    await expect(repository.deleteOwnedFlow(flowA)).rejects.toEqual(
      new AppError('not_found')
    );
  });

  it('fails closed if deletion affects multiple flows or returns a wrong ID', async () => {
    setupTransactions({ deletedRows: [{ id: flowA }, { id: flowA }] });
    const duplicateRepository = createPostgresFlowDeletePersistenceRepository(
      async () => sessionA
    );
    await expect(duplicateRepository.deleteOwnedFlow(flowA)).rejects.toEqual(
      new AppError('conflict')
    );

    setupTransactions({
      deletedRows: [{ id: '70000000-0000-4000-8000-000000000002' }],
    });
    const wrongIdRepository = createPostgresFlowDeletePersistenceRepository(
      async () => sessionA
    );
    await expect(wrongIdRepository.deleteOwnedFlow(flowA)).rejects.toEqual(
      new AppError('db_error')
    );
  });

  it('propagates safe database errors without driver details', async () => {
    const databaseFailure = new AppError('db_error');
    mocks.withTransaction
      .mockResolvedValueOnce(dbSuccess(membershipA))
      .mockResolvedValueOnce(dbFailure(databaseFailure));
    const repository = createPostgresFlowDeletePersistenceRepository(
      async () => sessionA
    );

    await expect(repository.deleteOwnedFlow(flowA)).rejects.toBe(
      databaseFailure
    );
  });
});
