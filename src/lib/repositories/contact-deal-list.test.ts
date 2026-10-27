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
import { createPostgresContactDealListRepository } from './contact-deal-list';

const sessionA = { userId: '00000000-0000-4000-8000-000000000001' };
const accountA = '10000000-0000-4000-8000-000000000001';
const contactA = '40000000-0000-4000-8000-000000000001';
const dealA = '90000000-0000-4000-8000-000000000001';
const pipelineA = '50000000-0000-4000-8000-000000000001';
const stageA = '60000000-0000-4000-8000-000000000001';
const dealRowA = {
  id: dealA,
  user_id: sessionA.userId,
  account_id: accountA,
  contact_id: contactA,
  contact_account_id: accountA,
  pipeline_id: pipelineA,
  pipeline_account_id: accountA,
  stage_id: stageA,
  stage_pipeline_id: pipelineA,
  conversation_id: null,
  assigned_to: null,
  title: 'Synthetic deal',
  value: '123.45',
  currency: 'USD',
  notes: null,
  expected_close_date: '2026-11-30',
  status: 'open',
  created_at: new Date('2026-10-18T12:00:00.000Z'),
  updated_at: null,
};

const membershipA = {
  userId: sessionA.userId,
  accountId: accountA,
  role: 'viewer',
  accountName: 'Synthetic Account A',
};

function setupTransactions({
  role = 'viewer',
  dealRows = [dealRowA],
}: {
  role?: string;
  dealRows?: Record<string, unknown>[];
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
      if (sql.includes('FROM public.deals AS d')) {
        return { rows: dealRows, rowCount: dealRows.length };
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

describe('PostgreSQL contact deal-list repository', () => {
  beforeEach(() => {
    mocks.withTransaction.mockReset();
  });

  it('requires a verified session before querying deals', async () => {
    const repository = createPostgresContactDealListRepository(
      async () => null
    );

    await expect(repository.listForContact(contactA)).rejects.toEqual(
      new AppError('unauthorized')
    );
    expect(mocks.withTransaction).not.toHaveBeenCalled();
  });

  it('allows viewers and scopes deal plus parents to verified account', async () => {
    const query = setupTransactions();
    const repository = createPostgresContactDealListRepository(
      async () => sessionA
    );

    await expect(repository.listForContact(contactA)).resolves.toEqual([
      {
        id: dealA,
        user_id: sessionA.userId,
        pipeline_id: pipelineA,
        stage_id: stageA,
        contact_id: contactA,
        title: 'Synthetic deal',
        value: 123.45,
        currency: 'USD',
        expected_close_date: '2026-11-30',
        status: 'open',
        created_at: '2026-10-18T12:00:00.000Z',
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
    expect(sql).toContain('WHERE d.account_id = $1');
    expect(sql).toContain('AND d.contact_id = $2');
    expect(sql).toContain('c.account_id = d.account_id');
    expect(sql).toContain('p.account_id = d.account_id');
    expect(sql).toContain('ps.pipeline_id = d.pipeline_id');
    expect(sql).toContain(
      "to_char(d.expected_close_date, 'YYYY-MM-DD') AS expected_close_date"
    );
    expect(sql).toContain('ORDER BY d.created_at DESC NULLS LAST, d.id DESC');
    expect(values).toEqual([accountA, contactA]);
  });

  it('returns empty results and omits nullable optional fields', async () => {
    setupTransactions({ dealRows: [] });
    const repository = createPostgresContactDealListRepository(
      async () => sessionA
    );

    await expect(repository.listForContact(contactA)).resolves.toEqual([]);

    setupTransactions({
      dealRows: [
        {
          ...dealRowA,
          conversation_id: null,
          assigned_to: null,
          currency: null,
          notes: null,
          expected_close_date: null,
          status: null,
        },
      ],
    });
    await expect(repository.listForContact(contactA)).resolves.toEqual([
      {
        id: dealA,
        user_id: sessionA.userId,
        pipeline_id: pipelineA,
        stage_id: stageA,
        contact_id: contactA,
        title: 'Synthetic deal',
        value: 123.45,
        created_at: '2026-10-18T12:00:00.000Z',
      },
    ]);
  });

  it('rejects invalid IDs, malformed parent rows, and invalid numeric values', async () => {
    const query = setupTransactions();
    const repository = createPostgresContactDealListRepository(
      async () => sessionA
    );

    await expect(repository.listForContact('not-a-uuid')).rejects.toEqual(
      new AppError('bad_request')
    );
    expect(
      query.mock.calls.some(([sql]) => sql.includes('FROM public.deals AS d'))
    ).toBe(false);

    setupTransactions({
      dealRows: [
        {
          ...dealRowA,
          pipeline_account_id: '10000000-0000-4000-8000-000000000002',
        },
      ],
    });
    await expect(repository.listForContact(contactA)).rejects.toEqual(
      new AppError('db_error')
    );

    setupTransactions({ dealRows: [{ ...dealRowA, value: 'Infinity' }] });
    await expect(repository.listForContact(contactA)).rejects.toEqual(
      new AppError('db_error')
    );
  });

  it('propagates safe database errors without exposing driver details', async () => {
    const databaseFailure = new AppError('db_error');
    mocks.withTransaction
      .mockResolvedValueOnce(dbSuccess(membershipA))
      .mockResolvedValueOnce(dbFailure(databaseFailure));
    const repository = createPostgresContactDealListRepository(
      async () => sessionA
    );

    await expect(repository.listForContact(contactA)).rejects.toBe(
      databaseFailure
    );
  });
});
