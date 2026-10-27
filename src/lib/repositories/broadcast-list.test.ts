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
import { createPostgresBroadcastListRepository } from './broadcast-list';

const sessionA = { userId: '00000000-0000-4000-8000-000000000003' };
const accountA = '10000000-0000-4000-8000-000000000001';
const broadcastRows: Record<string, unknown>[] = [
  {
    id: 'b0000000-0000-4000-8000-000000000001',
    name: 'Newest broadcast',
    template_name: 'appointment_reminder',
    status: 'sending',
    total_recipients: 10,
    delivered_count: 4,
    read_count: 2,
    created_at: '2026-10-20T10:00:00.000Z',
  },
  {
    id: 'a0000000-0000-4000-8000-000000000001',
    name: 'Older broadcast',
    template_name: 'new_listing',
    status: 'sent',
    total_recipients: 0,
    delivered_count: 0,
    read_count: 0,
    created_at: '2026-10-19T10:00:00.000Z',
  },
];

function setupTransactions({
  role = 'viewer',
  rows = broadcastRows,
}: {
  role?: string;
  rows?: Record<string, unknown>[];
} = {}) {
  const transactionQuery = vi.fn(
    async (...args: [sql: string, values?: readonly unknown[]]) => {
      const [sql] = args;
      if (sql.includes('set_config')) return { rows: [], rowCount: 1 };
      if (sql.includes('INNER JOIN public.accounts')) {
        return {
          rows: [
            {
              userId: sessionA.userId,
              accountId: accountA,
              role,
              accountName: 'Synthetic Account A',
            },
          ],
          rowCount: 1,
        };
      }
      if (sql.includes('FROM public.broadcasts AS b')) {
        return { rows, rowCount: rows.length };
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

describe('PostgreSQL broadcast-list repository', () => {
  beforeEach(() => {
    mocks.withTransaction.mockReset();
  });

  it('requires verified account membership before listing broadcasts', async () => {
    const repository = createPostgresBroadcastListRepository(async () => null);

    await expect(repository.listForCurrentAccount()).rejects.toEqual(
      new AppError('unauthorized')
    );
    expect(mocks.withTransaction).not.toHaveBeenCalled();
  });

  it('allows a viewer to read validated broadcast-card fields', async () => {
    setupTransactions({ role: 'viewer' });
    const repository = createPostgresBroadcastListRepository(
      async () => sessionA
    );

    await expect(repository.listForCurrentAccount()).resolves.toEqual(
      broadcastRows
    );
  });

  it('uses verified account scope, author consistency, stable order, and a safe projection', async () => {
    const query = setupTransactions();
    const repository = createPostgresBroadcastListRepository(
      async () => sessionA
    );

    await repository.listForCurrentAccount();

    const list = query.mock.calls.find(([sql]) =>
      sql.includes('FROM public.broadcasts AS b')
    );
    expect(list?.[0]).toContain('b.account_id = $1');
    expect(list?.[0]).toContain('WHERE b.account_id = $1');
    expect(list?.[0]).not.toContain('public.profiles AS creator');
    expect(list?.[0]).toContain('ORDER BY b.created_at DESC, b.id DESC');
    expect(list?.[1]).toEqual([accountA]);
    const selection = list?.[0].split('FROM public.broadcasts AS b')[0];
    expect(selection).not.toContain('SELECT *');
    expect(selection).not.toContain('template_variables');
    expect(selection).not.toContain('audience_filter');
    expect(selection).not.toContain('user_id');
    expect(
      query.mock.calls.some(
        ([sql, values]) =>
          sql === "SELECT set_config('request.jwt.claim.sub', $1, true)" &&
          values?.[0] === sessionA.userId
      )
    ).toBe(true);
  });

  it('returns an empty array when no broadcasts are visible', async () => {
    setupTransactions({ rows: [] });
    const repository = createPostgresBroadcastListRepository(
      async () => sessionA
    );

    await expect(repository.listForCurrentAccount()).resolves.toEqual([]);
  });

  it.each([
    ['invalid ID', { id: 'bad-id' }],
    ['invalid status', { status: 'paused' }],
    ['negative recipient count', { total_recipients: -1 }],
    ['fractional delivery count', { delivered_count: 1.5 }],
    ['unsafe read count', { read_count: Number.MAX_SAFE_INTEGER + 1 }],
    ['invalid timestamp', { created_at: 'not-a-timestamp' }],
  ])('fails closed for %s', async (_label, invalidFields) => {
    const rows = broadcastRows.map((row) => ({ ...row }));
    rows[0] = { ...rows[0], ...invalidFields };
    setupTransactions({ rows });
    const repository = createPostgresBroadcastListRepository(
      async () => sessionA
    );

    await expect(repository.listForCurrentAccount()).rejects.toEqual(
      new AppError('db_error')
    );
  });

  it('propagates safe database errors without driver details', async () => {
    const databaseFailure = new AppError('db_error');
    mocks.withTransaction
      .mockResolvedValueOnce(
        dbSuccess({
          userId: sessionA.userId,
          accountId: accountA,
          role: 'viewer',
          accountName: 'Synthetic Account A',
        })
      )
      .mockResolvedValueOnce(dbFailure(databaseFailure));
    const repository = createPostgresBroadcastListRepository(
      async () => sessionA
    );

    await expect(repository.listForCurrentAccount()).rejects.toBe(
      databaseFailure
    );
  });
});
