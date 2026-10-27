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
import { createPostgresPipelineDealListRepository } from './pipeline-deal-list';

const sessionA = { userId: '00000000-0000-4000-8000-000000000001' };
const accountA = '10000000-0000-4000-8000-000000000001';
const accountB = '10000000-0000-4000-8000-000000000002';
const pipelineA = '50000000-0000-4000-8000-000000000001';
const stageA = '60000000-0000-4000-8000-000000000001';
const dealA = '70000000-0000-4000-8000-000000000001';
const contactA = '40000000-0000-4000-8000-000000000001';
const profileA = '90000000-0000-4000-8000-000000000001';
const dealRowA = {
  id: dealA,
  user_id: sessionA.userId,
  account_id: accountA,
  pipeline_id: pipelineA,
  pipeline_account_id: accountA,
  stage_id: stageA,
  stage_pipeline_id: pipelineA,
  contact_id: contactA,
  contact_row_id: contactA,
  contact_account_id: accountA,
  contact_phone: '+15555550123',
  contact_name: 'Synthetic Contact',
  conversation_id: '80000000-0000-4000-8000-000000000001',
  assigned_to: profileA,
  assignee_row_id: profileA,
  assignee_account_id: accountA,
  assignee_full_name: 'Synthetic Agent',
  title: 'Synthetic deal',
  value: '450.75',
  currency: 'BRL',
  notes: 'Private synthetic note',
  expected_close_date: '2026-10-20',
  status: 'won',
  created_at: new Date('2026-10-18T10:00:00.000Z'),
  updated_at: new Date('2026-10-19T11:00:00.000Z'),
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
        return { rows: [{ ...membershipA, role }], rowCount: 1 };
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

describe('PostgreSQL pipeline deal-list repository', () => {
  beforeEach(() => {
    mocks.withTransaction.mockReset();
  });

  it('requires a verified session before querying deals', async () => {
    const repository = createPostgresPipelineDealListRepository(
      async () => null
    );

    await expect(repository.listForPipeline(pipelineA)).rejects.toEqual(
      new AppError('unauthorized')
    );
    expect(mocks.withTransaction).not.toHaveBeenCalled();
  });

  it('allows viewers, binds account and pipeline, and maps board summaries', async () => {
    const query = setupTransactions();
    const repository = createPostgresPipelineDealListRepository(
      async () => sessionA
    );

    await expect(repository.listForPipeline(pipelineA)).resolves.toEqual([
      {
        id: dealA,
        user_id: sessionA.userId,
        pipeline_id: pipelineA,
        stage_id: stageA,
        contact_id: contactA,
        conversation_id: '80000000-0000-4000-8000-000000000001',
        assigned_to: profileA,
        title: 'Synthetic deal',
        value: 450.75,
        currency: 'BRL',
        notes: 'Private synthetic note',
        expected_close_date: '2026-10-20',
        status: 'won',
        created_at: '2026-10-18T10:00:00.000Z',
        updated_at: '2026-10-19T11:00:00.000Z',
        contact: {
          id: contactA,
          phone: '+15555550123',
          name: 'Synthetic Contact',
        },
        assignee: { id: profileA, full_name: 'Synthetic Agent' },
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
    expect(sql).toContain('AND d.pipeline_id = $2');
    expect(sql).not.toContain('public.profiles AS deal_creator');
    expect(sql).not.toContain('public.profiles AS pipeline_creator');
    expect(sql).toContain('ps.pipeline_id = d.pipeline_id');
    expect(sql).toContain('c.account_id = d.account_id');
    expect(sql).toContain('assignee.account_id = d.account_id');
    expect(sql).toContain(
      "to_char(d.expected_close_date, 'YYYY-MM-DD') AS expected_close_date"
    );
    expect(sql).toContain('ORDER BY d.created_at DESC NULLS LAST, d.id DESC');
    expect(values).toEqual([accountA, pipelineA]);
  });

  it('preserves orphaned nullable values and omits unavailable related summaries', async () => {
    setupTransactions({
      dealRows: [
        {
          ...dealRowA,
          contact_id: null,
          contact_row_id: null,
          contact_account_id: null,
          contact_phone: null,
          contact_name: null,
          conversation_id: null,
          assigned_to: null,
          assignee_row_id: null,
          assignee_account_id: null,
          assignee_full_name: null,
          currency: null,
          notes: null,
          expected_close_date: null,
          status: null,
          created_at: null,
          updated_at: null,
        },
      ],
    });
    const repository = createPostgresPipelineDealListRepository(
      async () => sessionA
    );

    await expect(repository.listForPipeline(pipelineA)).resolves.toEqual([
      {
        id: dealA,
        user_id: sessionA.userId,
        pipeline_id: pipelineA,
        stage_id: stageA,
        contact_id: null,
        title: 'Synthetic deal',
        value: 450.75,
        created_at: null,
        updated_at: null,
      },
    ]);
  });

  it('returns an empty array when the pipeline has no deals', async () => {
    setupTransactions({ dealRows: [] });
    const repository = createPostgresPipelineDealListRepository(
      async () => sessionA
    );

    await expect(repository.listForPipeline(pipelineA)).resolves.toEqual([]);
  });

  it('rejects an invalid pipeline UUID before running its list query', async () => {
    const query = setupTransactions();
    const repository = createPostgresPipelineDealListRepository(
      async () => sessionA
    );

    await expect(repository.listForPipeline('not-a-uuid')).rejects.toEqual(
      new AppError('bad_request')
    );
    expect(
      query.mock.calls.some(([sql]) => sql.includes('FROM public.deals AS d'))
    ).toBe(false);
  });

  it('rejects malformed or mismatched deal, pipeline, and stage rows safely', async () => {
    setupTransactions({
      dealRows: [
        {
          ...dealRowA,
          account_id: accountB,
        },
      ],
    });
    const repository = createPostgresPipelineDealListRepository(
      async () => sessionA
    );

    await expect(repository.listForPipeline(pipelineA)).rejects.toEqual(
      new AppError('db_error')
    );

    setupTransactions({
      dealRows: [{ ...dealRowA, pipeline_account_id: accountB }],
    });
    await expect(repository.listForPipeline(pipelineA)).rejects.toEqual(
      new AppError('db_error')
    );

    setupTransactions({
      dealRows: [
        {
          ...dealRowA,
          stage_pipeline_id: '50000000-0000-4000-8000-000000000002',
        },
      ],
    });
    await expect(repository.listForPipeline(pipelineA)).rejects.toEqual(
      new AppError('db_error')
    );
  });

  it('rejects cross-account joined contact and assignee rows', async () => {
    setupTransactions({
      dealRows: [{ ...dealRowA, contact_account_id: accountB }],
    });
    const repository = createPostgresPipelineDealListRepository(
      async () => sessionA
    );

    await expect(repository.listForPipeline(pipelineA)).rejects.toEqual(
      new AppError('db_error')
    );

    setupTransactions({
      dealRows: [{ ...dealRowA, assignee_account_id: accountB }],
    });
    await expect(repository.listForPipeline(pipelineA)).rejects.toEqual(
      new AppError('db_error')
    );
  });

  it('propagates safe database errors without exposing driver details', async () => {
    const databaseFailure = new AppError('db_error');
    mocks.withTransaction
      .mockResolvedValueOnce(dbSuccess(membershipA))
      .mockResolvedValueOnce(dbFailure(databaseFailure));
    const repository = createPostgresPipelineDealListRepository(
      async () => sessionA
    );

    await expect(repository.listForPipeline(pipelineA)).rejects.toBe(
      databaseFailure
    );
  });
});
