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
import { createPostgresContactNoteListRepository } from './contact-note-list';

const sessionA = { userId: '00000000-0000-4000-8000-000000000001' };
const accountA = '10000000-0000-4000-8000-000000000001';
const contactA = '40000000-0000-4000-8000-000000000001';
const noteA = '80000000-0000-4000-8000-000000000001';
const noteRowA = {
  id: noteA,
  contact_id: contactA,
  user_id: sessionA.userId,
  account_id: accountA,
  contact_account_id: accountA,
  note_text: 'Synthetic note',
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
  noteRows = [noteRowA],
}: {
  role?: string;
  noteRows?: Record<string, unknown>[];
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
      if (sql.includes('FROM public.contact_notes AS n')) {
        return { rows: noteRows, rowCount: noteRows.length };
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

describe('PostgreSQL contact-note list repository', () => {
  beforeEach(() => {
    mocks.withTransaction.mockReset();
  });

  it('requires a verified session before querying notes', async () => {
    const repository = createPostgresContactNoteListRepository(
      async () => null
    );

    await expect(repository.listForContact(contactA)).rejects.toEqual(
      new AppError('unauthorized')
    );
    expect(mocks.withTransaction).not.toHaveBeenCalled();
  });

  it('allows viewers and scopes notes by verified account and contact', async () => {
    const query = setupTransactions();
    const repository = createPostgresContactNoteListRepository(
      async () => sessionA
    );

    await expect(repository.listForContact(contactA)).resolves.toEqual([
      {
        id: noteA,
        contact_id: contactA,
        user_id: sessionA.userId,
        note_text: 'Synthetic note',
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
    expect(sql).toContain('WHERE n.account_id = $1');
    expect(sql).toContain('AND n.contact_id = $2');
    expect(sql).toContain('c.account_id = n.account_id');
    expect(sql).toContain('ORDER BY n.created_at DESC NULLS LAST, n.id DESC');
    expect(values).toEqual([accountA, contactA]);
  });

  it('returns an empty array when the contact has no notes', async () => {
    setupTransactions({ noteRows: [] });
    const repository = createPostgresContactNoteListRepository(
      async () => sessionA
    );

    await expect(repository.listForContact(contactA)).resolves.toEqual([]);
  });

  it('rejects malformed or cross-account note-parent rows safely', async () => {
    setupTransactions({
      noteRows: [
        {
          ...noteRowA,
          contact_account_id: '10000000-0000-4000-8000-000000000002',
        },
      ],
    });
    const repository = createPostgresContactNoteListRepository(
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
    const repository = createPostgresContactNoteListRepository(
      async () => sessionA
    );

    await expect(repository.listForContact(contactA)).rejects.toBe(
      databaseFailure
    );
  });
});
