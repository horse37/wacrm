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
import { createPostgresPipelineDealDeleteRepository } from './pipeline-deal-delete';

const sessionA = { userId: '00000000-0000-4000-8000-000000000001' };
const accountA = '10000000-0000-4000-8000-000000000001';
const dealA = '70000000-0000-4000-8000-000000000001';
const membershipA = {
  userId: sessionA.userId,
  accountId: accountA,
  role: 'agent',
  accountName: 'Synthetic Account A',
};

function setupTransactions({
  role = 'agent',
  deletedRows = [{ id: dealA }],
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
      if (sql.includes('DELETE FROM public.deals AS d')) {
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

describe('PostgreSQL pipeline deal-delete repository', () => {
  beforeEach(() => {
    mocks.withTransaction.mockReset();
  });

  it('requires a verified session before opening a delete transaction', async () => {
    const repository = createPostgresPipelineDealDeleteRepository(
      async () => null
    );

    await expect(repository.deleteDeal(dealA)).rejects.toEqual(
      new AppError('unauthorized')
    );
    expect(mocks.withTransaction).not.toHaveBeenCalled();
  });

  it('denies viewers before the delete query', async () => {
    const query = setupTransactions({ role: 'viewer' });
    const repository = createPostgresPipelineDealDeleteRepository(
      async () => sessionA
    );

    await expect(repository.deleteDeal(dealA)).rejects.toEqual(
      new AppError('forbidden')
    );
    expect(
      query.mock.calls.some(([sql]) =>
        sql.includes('DELETE FROM public.deals AS d')
      )
    ).toBe(false);
  });

  it('validates the deal UUID before issuing the delete query', async () => {
    const query = setupTransactions();
    const repository = createPostgresPipelineDealDeleteRepository(
      async () => sessionA
    );

    await expect(repository.deleteDeal('invalid')).rejects.toEqual(
      new AppError('bad_request')
    );
    expect(
      query.mock.calls.some(([sql]) =>
        sql.includes('DELETE FROM public.deals AS d')
      )
    ).toBe(false);
  });

  it('deletes only the requested deal in the verified account', async () => {
    const query = setupTransactions();
    const repository = createPostgresPipelineDealDeleteRepository(
      async () => sessionA
    );

    await expect(repository.deleteDeal(dealA)).resolves.toBeUndefined();

    const deletion = query.mock.calls.find(([sql]) =>
      sql.includes('DELETE FROM public.deals AS d')
    );
    expect(deletion?.[0]).toContain('d.account_id = $1');
    expect(deletion?.[0]).toContain('d.id = $2');
    expect(deletion?.[0]).not.toContain('public.profiles AS deal_creator');
    expect(deletion?.[0]).not.toContain('public.profiles AS pipeline_creator');
    expect(deletion?.[0]).toContain('p.account_id = d.account_id');
    expect(deletion?.[0]).toContain('p.account_id = d.account_id');
    expect(deletion?.[0]).toContain('RETURNING d.id::text AS id');
    expect(deletion?.[1]).toEqual([accountA, dealA]);
    expect(
      query.mock.calls.some(
        ([sql, values]) =>
          sql === "SELECT set_config('request.jwt.claim.sub', $1, true)" &&
          values?.[0] === sessionA.userId
      )
    ).toBe(true);
  });

  it('returns not found when the deal is missing or outside the account', async () => {
    setupTransactions({ deletedRows: [] });
    const repository = createPostgresPipelineDealDeleteRepository(
      async () => sessionA
    );

    await expect(repository.deleteDeal(dealA)).rejects.toEqual(
      new AppError('not_found')
    );
  });

  it('fails closed if the delete unexpectedly affects multiple rows', async () => {
    setupTransactions({ deletedRows: [{ id: dealA }, { id: dealA }] });
    const repository = createPostgresPipelineDealDeleteRepository(
      async () => sessionA
    );

    await expect(repository.deleteDeal(dealA)).rejects.toEqual(
      new AppError('conflict')
    );
  });

  it('propagates safe database errors without driver details', async () => {
    const databaseFailure = new AppError('db_error');
    mocks.withTransaction
      .mockResolvedValueOnce(dbSuccess(membershipA))
      .mockResolvedValueOnce(dbFailure(databaseFailure));
    const repository = createPostgresPipelineDealDeleteRepository(
      async () => sessionA
    );

    await expect(repository.deleteDeal(dealA)).rejects.toBe(databaseFailure);
  });
});
