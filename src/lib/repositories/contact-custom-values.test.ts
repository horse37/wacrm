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
import { createPostgresContactCustomValuesRepository } from './contact-custom-values';

const sessionA = { userId: '00000000-0000-4000-8000-000000000001' };
const accountA = '10000000-0000-4000-8000-000000000001';
const contactA = '40000000-0000-4000-8000-000000000001';
const fieldA = '70000000-0000-4000-8000-000000000001';
const valueA = '90000000-0000-4000-8000-000000000001';
const valueRowA = {
  id: valueA,
  contact_id: contactA,
  custom_field_id: fieldA,
  value: 'Synthetic value',
  contact_account_id: accountA,
  field_account_id: accountA,
};

const membershipA = {
  userId: sessionA.userId,
  accountId: accountA,
  role: 'viewer',
  accountName: 'Synthetic Account A',
};

function setupTransactions({
  role = 'viewer',
  valueRows = [valueRowA],
}: {
  role?: string;
  valueRows?: Record<string, unknown>[];
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
      if (sql.includes('FROM public.contact_custom_values AS ccv')) {
        return { rows: valueRows, rowCount: valueRows.length };
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

describe('PostgreSQL contact custom values repository', () => {
  beforeEach(() => {
    mocks.withTransaction.mockReset();
  });

  it('requires a verified session before querying values', async () => {
    const repository = createPostgresContactCustomValuesRepository(
      async () => null
    );

    await expect(repository.listForContact(contactA)).rejects.toEqual(
      new AppError('unauthorized')
    );
    expect(mocks.withTransaction).not.toHaveBeenCalled();
  });

  it('allows viewers and scopes the query to the verified account and contact', async () => {
    const query = setupTransactions();
    const repository = createPostgresContactCustomValuesRepository(
      async () => sessionA
    );

    await expect(repository.listForContact(contactA)).resolves.toEqual([
      {
        id: valueA,
        contact_id: contactA,
        custom_field_id: fieldA,
        value: 'Synthetic value',
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
    expect(sql).toContain('WHERE c.account_id = $1');
    expect(sql).toContain('AND ccv.contact_id = $2');
    expect(sql).toContain('cf.account_id = c.account_id');
    expect(sql).toContain('ORDER BY ccv.custom_field_id ASC, ccv.id ASC');
    expect(values).toEqual([accountA, contactA]);
  });

  it('omits null values to match the existing optional projection', async () => {
    setupTransactions({ valueRows: [{ ...valueRowA, value: null }] });
    const repository = createPostgresContactCustomValuesRepository(
      async () => sessionA
    );

    await expect(repository.listForContact(contactA)).resolves.toEqual([
      { id: valueA, contact_id: contactA, custom_field_id: fieldA },
    ]);
  });

  it('returns an empty array when a contact has no custom values', async () => {
    setupTransactions({ valueRows: [] });
    const repository = createPostgresContactCustomValuesRepository(
      async () => sessionA
    );

    await expect(repository.listForContact(contactA)).resolves.toEqual([]);
  });

  it('rejects malformed IDs and rows whose parents cross the account boundary', async () => {
    setupTransactions({
      valueRows: [
        {
          ...valueRowA,
          field_account_id: '10000000-0000-4000-8000-000000000002',
        },
      ],
    });
    const repository = createPostgresContactCustomValuesRepository(
      async () => sessionA
    );

    await expect(repository.listForContact(contactA)).rejects.toEqual(
      new AppError('db_error')
    );
    await expect(repository.listForContact('not-a-uuid')).rejects.toEqual(
      new AppError('bad_request')
    );
  });

  it('propagates safe database errors without exposing driver details', async () => {
    const databaseFailure = new AppError('db_error');
    mocks.withTransaction
      .mockResolvedValueOnce(dbSuccess(membershipA))
      .mockResolvedValueOnce(dbFailure(databaseFailure));
    const repository = createPostgresContactCustomValuesRepository(
      async () => sessionA
    );

    await expect(repository.listForContact(contactA)).rejects.toBe(
      databaseFailure
    );
  });
});
