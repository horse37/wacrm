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
import { createPostgresCustomFieldListRepository } from './custom-field-list';

const sessionA = { userId: '00000000-0000-4000-8000-000000000001' };
const accountA = '10000000-0000-4000-8000-000000000001';
const fieldA = '70000000-0000-4000-8000-000000000001';
const fieldRowA = {
  id: fieldA,
  user_id: sessionA.userId,
  account_id: accountA,
  field_name: 'Synthetic field A',
  field_type: 'text',
  field_options: { maxLength: 80 },
  created_at: new Date('2026-10-18T10:00:00.000Z'),
};

const membershipA = {
  userId: sessionA.userId,
  accountId: accountA,
  role: 'viewer',
  accountName: 'Synthetic Account A',
};

function setupTransactions({
  role = 'viewer',
  fieldRows = [fieldRowA],
}: {
  role?: string;
  fieldRows?: Record<string, unknown>[];
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
      if (sql.includes('FROM public.custom_fields AS cf')) {
        return { rows: fieldRows, rowCount: fieldRows.length };
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

describe('PostgreSQL custom-field list repository', () => {
  beforeEach(() => {
    mocks.withTransaction.mockReset();
  });

  it('requires a verified session before querying custom fields', async () => {
    const repository = createPostgresCustomFieldListRepository(
      async () => null
    );

    await expect(repository.list()).rejects.toEqual(
      new AppError('unauthorized')
    );
    expect(mocks.withTransaction).not.toHaveBeenCalled();
  });

  it('allows viewers and maps fields in stable alphabetical order', async () => {
    const query = setupTransactions({
      fieldRows: [
        {
          ...fieldRowA,
          field_options: null,
          field_name: 'Same name',
        },
        {
          ...fieldRowA,
          id: '70000000-0000-4000-8000-000000000002',
          field_options: null,
          field_name: 'Same name',
        },
      ],
    });
    const repository = createPostgresCustomFieldListRepository(
      async () => sessionA
    );

    await expect(repository.list()).resolves.toEqual([
      {
        id: fieldA,
        user_id: sessionA.userId,
        account_id: accountA,
        field_name: 'Same name',
        field_type: 'text',
        created_at: '2026-10-18T10:00:00.000Z',
      },
      {
        id: '70000000-0000-4000-8000-000000000002',
        user_id: sessionA.userId,
        account_id: accountA,
        field_name: 'Same name',
        field_type: 'text',
        created_at: '2026-10-18T10:00:00.000Z',
      },
    ]);

    expect(query.mock.calls[0]).toEqual([
      "SELECT set_config('request.jwt.claim.sub', $1, true)",
      [sessionA.userId],
    ]);
    expect(query.mock.calls[2]).toEqual([
      "SELECT set_config('request.jwt.claim.sub', $1, true)",
      [sessionA.userId],
    ]);
    const [sql, values] = query.mock.calls[3] ?? [];
    expect(sql).toContain('WHERE cf.account_id = $1');
    expect(sql).toContain('ORDER BY cf.field_name ASC, cf.id ASC');
    expect(values).toEqual([accountA]);
  });

  it('returns field options when the database value is an object', async () => {
    setupTransactions();
    const repository = createPostgresCustomFieldListRepository(
      async () => sessionA
    );

    await expect(repository.list()).resolves.toEqual([
      {
        id: fieldA,
        user_id: sessionA.userId,
        account_id: accountA,
        field_name: 'Synthetic field A',
        field_type: 'text',
        field_options: { maxLength: 80 },
        created_at: '2026-10-18T10:00:00.000Z',
      },
    ]);
  });

  it('returns an empty array when the account has no custom fields', async () => {
    setupTransactions({ fieldRows: [] });
    const repository = createPostgresCustomFieldListRepository(
      async () => sessionA
    );

    await expect(repository.list()).resolves.toEqual([]);
  });

  it('rejects malformed, cross-account, or invalid option rows safely', async () => {
    setupTransactions({
      fieldRows: [
        {
          ...fieldRowA,
          account_id: '10000000-0000-4000-8000-000000000002',
        },
      ],
    });
    const repository = createPostgresCustomFieldListRepository(
      async () => sessionA
    );

    await expect(repository.list()).rejects.toEqual(new AppError('db_error'));

    setupTransactions({ fieldRows: [{ ...fieldRowA, field_options: [] }] });
    await expect(repository.list()).rejects.toEqual(new AppError('db_error'));
  });

  it('propagates safe database errors without exposing driver details', async () => {
    const databaseFailure = new AppError('db_error');
    mocks.withTransaction
      .mockResolvedValueOnce(dbSuccess(membershipA))
      .mockResolvedValueOnce(dbFailure(databaseFailure));
    const repository = createPostgresCustomFieldListRepository(
      async () => sessionA
    );

    await expect(repository.list()).rejects.toBe(databaseFailure);
  });
});
