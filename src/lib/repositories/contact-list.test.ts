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
import { createPostgresContactListRepository } from './contact-list';

const sessionA = { userId: '00000000-0000-4000-8000-000000000001' };
const accountA = '10000000-0000-4000-8000-000000000001';
const contactA = '40000000-0000-4000-8000-000000000001';
const contactRowA = {
  total_count: '42',
  id: contactA,
  user_id: sessionA.userId,
  account_id: accountA,
  phone: '+1 (555) 000-0001',
  phone_normalized: '15550000001',
  name: 'Synthetic contact A',
  email: 'contact-a@example.invalid',
  company: 'Synthetic company A',
  avatar_url: null,
  created_at: new Date('2026-10-18T10:00:00.000Z'),
  updated_at: new Date('2026-10-18T11:00:00.000Z'),
};

const membershipA = {
  userId: sessionA.userId,
  accountId: accountA,
  role: 'viewer',
  accountName: 'Synthetic Account A',
};

function setupTransactions({
  role = 'viewer',
  contactRows = [contactRowA],
}: {
  role?: string;
  contactRows?: Record<string, unknown>[];
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
      if (sql.includes('WITH filtered AS MATERIALIZED')) {
        return { rows: contactRows, rowCount: contactRows.length };
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

describe('PostgreSQL contact list repository', () => {
  beforeEach(() => {
    mocks.withTransaction.mockReset();
  });

  it('requires a verified session before querying contacts', async () => {
    const repository = createPostgresContactListRepository(async () => null);

    await expect(
      repository.listPage({ page: 0, pageSize: 25 })
    ).rejects.toEqual(new AppError('unauthorized'));
    expect(mocks.withTransaction).not.toHaveBeenCalled();
  });

  it('allows viewers and binds account, search, page size, and offset', async () => {
    const query = setupTransactions();
    const repository = createPostgresContactListRepository(
      async () => sessionA
    );

    await expect(
      repository.listPage({ page: 1, pageSize: 25, search: '  synthetic  ' })
    ).resolves.toEqual({
      contacts: [
        {
          id: contactA,
          user_id: sessionA.userId,
          account_id: accountA,
          phone: '+1 (555) 000-0001',
          phone_normalized: '15550000001',
          name: 'Synthetic contact A',
          email: 'contact-a@example.invalid',
          company: 'Synthetic company A',
          created_at: '2026-10-18T10:00:00.000Z',
          updated_at: '2026-10-18T11:00:00.000Z',
        },
      ],
      totalCount: 42,
    });

    expect(query.mock.calls[0]).toEqual([
      "SELECT set_config('request.jwt.claim.sub', $1, true)",
      [sessionA.userId],
    ]);
    expect(query.mock.calls[2]).toEqual([
      "SELECT set_config('request.jwt.claim.sub', $1, true)",
      [sessionA.userId],
    ]);
    const [sql, values] = query.mock.calls[3] ?? [];
    expect(sql).toMatch(/WHERE c\.account_id = \$1/);
    expect(sql).toContain('c.name ILIKE $2');
    expect(sql).toContain('c.phone ILIKE $2');
    expect(sql).toContain('c.email ILIKE $2');
    expect(sql).toContain("ESCAPE E'\\\\'");
    expect(sql).toContain('ORDER BY c.created_at DESC NULLS FIRST, c.id ASC');
    expect(values).toEqual([accountA, '%synthetic%', 25, 25]);
  });

  it('escapes LIKE wildcard characters in literal search text', async () => {
    const query = setupTransactions();
    const repository = createPostgresContactListRepository(
      async () => sessionA
    );

    await repository.listPage({ page: 0, search: ' A%_\\ ' });

    expect(query.mock.calls[3]?.[1]).toEqual([
      accountA,
      '%A\\%\\_\\\\%',
      25,
      0,
    ]);
  });

  it('preserves the exact count when the requested page is empty', async () => {
    const emptyPageRow = {
      total_count: '31',
      id: null,
      user_id: null,
      account_id: null,
      phone: null,
      phone_normalized: null,
      name: null,
      email: null,
      company: null,
      avatar_url: null,
      created_at: null,
      updated_at: null,
    };
    const query = setupTransactions({ contactRows: [emptyPageRow] });
    const repository = createPostgresContactListRepository(
      async () => sessionA
    );

    await expect(
      repository.listPage({ page: 3, pageSize: 10 })
    ).resolves.toEqual({ contacts: [], totalCount: 31 });
    expect(query.mock.calls[3]?.[1]).toEqual([accountA, null, 10, 30]);
  });

  it('rejects invalid pagination without running the list query', async () => {
    const query = setupTransactions();
    const repository = createPostgresContactListRepository(
      async () => sessionA
    );

    await expect(
      repository.listPage({ page: -1, pageSize: 25 })
    ).rejects.toEqual(new AppError('bad_request'));
    expect(
      query.mock.calls.some(([sql]) =>
        sql.includes('WITH filtered AS MATERIALIZED')
      )
    ).toBe(false);
  });

  it('rejects malformed contact rows safely', async () => {
    setupTransactions({
      contactRows: [
        { ...contactRowA, account_id: '10000000-0000-4000-8000-000000000002' },
      ],
    });
    const repository = createPostgresContactListRepository(
      async () => sessionA
    );

    await expect(repository.listPage({ page: 0 })).rejects.toEqual(
      new AppError('db_error')
    );
  });

  it('propagates safe database errors without exposing driver details', async () => {
    const databaseFailure = new AppError('db_error');
    mocks.withTransaction
      .mockResolvedValueOnce(dbSuccess(membershipA))
      .mockResolvedValueOnce(dbFailure(databaseFailure));
    const repository = createPostgresContactListRepository(
      async () => sessionA
    );

    await expect(repository.listPage({ page: 0 })).rejects.toBe(
      databaseFailure
    );
  });
});
