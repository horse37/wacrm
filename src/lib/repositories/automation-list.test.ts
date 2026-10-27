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
import { createPostgresAutomationListRepository } from './automation-list';

const sessionA = { userId: '00000000-0000-4000-8000-000000000003' };
const accountA = '10000000-0000-4000-8000-000000000001';
const membershipA = {
  userId: sessionA.userId,
  accountId: accountA,
  role: 'viewer',
  accountName: 'Synthetic Account A',
};
const automationRows = [
  {
    id: 'b0000000-0000-4000-8000-000000000001',
    name: 'Newest automation',
    description: null,
    trigger_type: 'new_message_received',
    is_active: true,
    execution_count: 3,
    last_executed_at: null,
  },
  {
    id: 'a0000000-0000-4000-8000-000000000001',
    name: 'Older automation',
    description: 'Visible to this account',
    trigger_type: 'new_contact_created',
    is_active: false,
    execution_count: 0,
    last_executed_at: '2026-10-19T10:00:00.000Z',
  },
];

function setupTransactions({
  role = 'viewer',
  rows = automationRows,
}: {
  role?: string;
  rows?: Record<string, unknown>[];
} = {}) {
  const transactionQuery = vi.fn(
    async (...args: [sql: string, values?: readonly unknown[]]) => {
      const [sql] = args;
      if (sql.includes('set_config')) return { rows: [], rowCount: 1 };
      if (sql.includes('INNER JOIN public.accounts')) {
        return { rows: [{ ...membershipA, role }], rowCount: 1 };
      }
      if (sql.includes('FROM public.automations AS a')) {
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

describe('PostgreSQL automation-list repository', () => {
  beforeEach(() => {
    mocks.withTransaction.mockReset();
  });

  it('requires verified account membership before opening the list transaction', async () => {
    const repository = createPostgresAutomationListRepository(async () => null);

    await expect(repository.listForCurrentAccount()).rejects.toEqual(
      new AppError('unauthorized')
    );
    expect(mocks.withTransaction).not.toHaveBeenCalled();
  });

  it('allows a viewer to read the account list', async () => {
    const query = setupTransactions({ role: 'viewer' });
    const repository = createPostgresAutomationListRepository(
      async () => sessionA
    );

    await expect(repository.listForCurrentAccount()).resolves.toEqual(
      automationRows
    );
    expect(
      query.mock.calls.some(([sql]) =>
        sql.includes('FROM public.automations AS a')
      )
    ).toBe(true);
  });

  it('uses verified account scope, creator consistency, stable order and a safe projection', async () => {
    const query = setupTransactions();
    const repository = createPostgresAutomationListRepository(
      async () => sessionA
    );

    await repository.listForCurrentAccount();

    const list = query.mock.calls.find(([sql]) =>
      sql.includes('FROM public.automations AS a')
    );
    expect(list?.[0]).toContain('a.account_id = $1');
    expect(list?.[0]).toContain('WHERE a.account_id = $1');
    expect(list?.[0]).not.toContain('public.profiles AS creator');
    expect(list?.[0]).toContain('ORDER BY a.created_at DESC, a.id DESC');
    expect(list?.[1]).toEqual([accountA]);
    const selection = list?.[0].split('FROM public.automations AS a')[0];
    expect(selection).not.toContain('trigger_config');
    expect(selection).not.toContain('user_id');
    expect(
      query.mock.calls.some(
        ([sql, values]) =>
          sql === "SELECT set_config('request.jwt.claim.sub', $1, true)" &&
          values?.[0] === sessionA.userId
      )
    ).toBe(true);
  });

  it('returns an empty array when no automations are visible', async () => {
    setupTransactions({ rows: [] });
    const repository = createPostgresAutomationListRepository(
      async () => sessionA
    );

    await expect(repository.listForCurrentAccount()).resolves.toEqual([]);
  });

  it('propagates safe database errors without driver details', async () => {
    const databaseFailure = new AppError('db_error');
    mocks.withTransaction
      .mockResolvedValueOnce(dbSuccess(membershipA))
      .mockResolvedValueOnce(dbFailure(databaseFailure));
    const repository = createPostgresAutomationListRepository(
      async () => sessionA
    );

    await expect(repository.listForCurrentAccount()).rejects.toBe(
      databaseFailure
    );
  });
});
