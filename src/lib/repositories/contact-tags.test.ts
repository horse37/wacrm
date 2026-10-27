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
import { createPostgresContactTagsRepository } from './contact-tags';

const sessionA = { userId: '00000000-0000-4000-8000-000000000001' };
const accountA = '10000000-0000-4000-8000-000000000001';
const contactA = '40000000-0000-4000-8000-000000000001';
const tagA = '60000000-0000-4000-8000-000000000001';
const assignmentA = '80000000-0000-4000-8000-000000000001';
const assignmentRowA = {
  id: assignmentA,
  contact_id: contactA,
  tag_id: tagA,
  contact_account_id: accountA,
  tag_account_id: accountA,
};

const membershipA = {
  userId: sessionA.userId,
  accountId: accountA,
  role: 'viewer',
  accountName: 'Synthetic Account A',
};

function setupTransactions({
  role = 'viewer',
  assignmentRows = [assignmentRowA],
}: {
  role?: string;
  assignmentRows?: Record<string, unknown>[];
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
      if (sql.includes('FROM public.contact_tags AS ct')) {
        return { rows: assignmentRows, rowCount: assignmentRows.length };
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

describe('PostgreSQL contact tags repository', () => {
  beforeEach(() => {
    mocks.withTransaction.mockReset();
  });

  it('requires a verified session before querying assignments', async () => {
    const repository = createPostgresContactTagsRepository(async () => null);

    await expect(repository.listForContact(contactA)).rejects.toEqual(
      new AppError('unauthorized')
    );
    expect(mocks.withTransaction).not.toHaveBeenCalled();
  });

  it('allows viewers and scopes contact and tag joins to the verified account', async () => {
    const query = setupTransactions();
    const repository = createPostgresContactTagsRepository(
      async () => sessionA
    );

    await expect(
      repository.listForContact(contactA.toUpperCase())
    ).resolves.toEqual([
      { id: assignmentA, contact_id: contactA, tag_id: tagA },
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
    expect(sql).toContain('c.account_id = $1');
    expect(sql).toContain('ct.contact_id = $2');
    expect(sql).toContain('t.account_id = c.account_id');
    expect(sql).toContain('ORDER BY ct.created_at ASC NULLS LAST, ct.id ASC');
    expect(values).toEqual([accountA, contactA]);
  });

  it('returns no assignments when the contact is unavailable or untagged', async () => {
    setupTransactions({ assignmentRows: [] });
    const repository = createPostgresContactTagsRepository(
      async () => sessionA
    );

    await expect(repository.listForContact(contactA)).resolves.toEqual([]);
  });

  it('rejects invalid UUIDs before running the assignment query', async () => {
    const query = setupTransactions();
    const repository = createPostgresContactTagsRepository(
      async () => sessionA
    );

    await expect(repository.listForContact('not-a-uuid')).rejects.toEqual(
      new AppError('bad_request')
    );
    expect(
      query.mock.calls.some(([sql]) =>
        sql.includes('FROM public.contact_tags AS ct')
      )
    ).toBe(false);
  });

  it('rejects inconsistent parent-account rows safely', async () => {
    setupTransactions({
      assignmentRows: [
        {
          ...assignmentRowA,
          tag_account_id: '10000000-0000-4000-8000-000000000002',
        },
      ],
    });
    const repository = createPostgresContactTagsRepository(
      async () => sessionA
    );

    await expect(repository.listForContact(contactA)).rejects.toEqual(
      new AppError('db_error')
    );
  });

  it('propagates safe database errors without exposing driver details', async () => {
    const databaseFailure = new AppError('db_error');
    mocks.withTransaction
      .mockResolvedValueOnce(dbSuccess(membershipA))
      .mockResolvedValueOnce(dbFailure(databaseFailure));
    const repository = createPostgresContactTagsRepository(
      async () => sessionA
    );

    await expect(repository.listForContact(contactA)).rejects.toBe(
      databaseFailure
    );
  });
});
