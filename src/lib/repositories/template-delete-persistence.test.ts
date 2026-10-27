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
import { createPostgresTemplateDeletePersistenceRepository } from './template-delete-persistence';

const sessionA = { userId: '00000000-0000-4000-8000-000000000001' };
const accountA = '10000000-0000-4000-8000-000000000001';
const templateA = '30000000-0000-4000-8000-000000000001';
const membershipA = {
  userId: sessionA.userId,
  accountId: accountA,
  role: 'admin',
  accountName: 'Synthetic Account A',
};

function setupTransactions({
  role = 'admin',
  deletedRows = [{ id: templateA }],
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
      if (sql.includes('DELETE FROM public.message_templates AS template')) {
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

describe('PostgreSQL template-delete persistence repository', () => {
  beforeEach(() => {
    mocks.withTransaction.mockReset();
  });

  it('requires a verified session before opening a delete transaction', async () => {
    const repository = createPostgresTemplateDeletePersistenceRepository(
      async () => null
    );

    await expect(repository.deleteTemplate(templateA)).rejects.toEqual(
      new AppError('unauthorized')
    );
    expect(mocks.withTransaction).not.toHaveBeenCalled();
  });

  it('denies non-admins before issuing the delete query', async () => {
    const query = setupTransactions({ role: 'agent' });
    const repository = createPostgresTemplateDeletePersistenceRepository(
      async () => sessionA
    );

    await expect(repository.deleteTemplate(templateA)).rejects.toEqual(
      new AppError('forbidden')
    );
    expect(
      query.mock.calls.some(([sql]) =>
        sql.includes('DELETE FROM public.message_templates AS template')
      )
    ).toBe(false);
  });

  it('validates the template UUID before issuing the delete query', async () => {
    const query = setupTransactions();
    const repository = createPostgresTemplateDeletePersistenceRepository(
      async () => sessionA
    );

    await expect(repository.deleteTemplate('../not-a-uuid')).rejects.toEqual(
      new AppError('bad_request')
    );
    expect(
      query.mock.calls.some(([sql]) =>
        sql.includes('DELETE FROM public.message_templates AS template')
      )
    ).toBe(false);
  });

  it('deletes only the requested consistent template in the verified account', async () => {
    const query = setupTransactions();
    const repository = createPostgresTemplateDeletePersistenceRepository(
      async () => sessionA
    );

    await expect(repository.deleteTemplate(templateA)).resolves.toBeUndefined();

    const deletion = query.mock.calls.find(([sql]) =>
      sql.includes('DELETE FROM public.message_templates AS template')
    );
    expect(deletion?.[0]).toContain('template.account_id = $1');
    expect(deletion?.[0]).toContain('template.id = $2');
    expect(deletion?.[0]).toContain('template.account_id = $1');
    expect(deletion?.[0]).not.toContain('public.profiles AS creator');
    expect(deletion?.[0]).toContain('RETURNING template.id::text AS id');
    expect(deletion?.[1]).toEqual([accountA, templateA]);
    expect(
      query.mock.calls.some(
        ([sql, values]) =>
          sql === "SELECT set_config('request.jwt.claim.sub', $1, true)" &&
          values?.[0] === sessionA.userId
      )
    ).toBe(true);
  });

  it('returns not found when the template is missing or outside the account', async () => {
    setupTransactions({ deletedRows: [] });
    const repository = createPostgresTemplateDeletePersistenceRepository(
      async () => sessionA
    );

    await expect(repository.deleteTemplate(templateA)).rejects.toEqual(
      new AppError('not_found')
    );
  });

  it('fails closed if the delete unexpectedly affects multiple rows', async () => {
    setupTransactions({ deletedRows: [{ id: templateA }, { id: templateA }] });
    const repository = createPostgresTemplateDeletePersistenceRepository(
      async () => sessionA
    );

    await expect(repository.deleteTemplate(templateA)).rejects.toEqual(
      new AppError('conflict')
    );
  });

  it('fails closed if PostgreSQL returns a malformed or different UUID', async () => {
    setupTransactions({ deletedRows: [{ id: 'not-a-uuid' }] });
    const repository = createPostgresTemplateDeletePersistenceRepository(
      async () => sessionA
    );

    await expect(repository.deleteTemplate(templateA)).rejects.toEqual(
      new AppError('db_error')
    );
  });

  it('propagates safe database errors without driver details', async () => {
    const databaseFailure = new AppError('db_error');
    mocks.withTransaction
      .mockResolvedValueOnce(dbSuccess(membershipA))
      .mockResolvedValueOnce(dbFailure(databaseFailure));
    const repository = createPostgresTemplateDeletePersistenceRepository(
      async () => sessionA
    );

    await expect(repository.deleteTemplate(templateA)).rejects.toBe(
      databaseFailure
    );
  });
});
