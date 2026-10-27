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
import { createPostgresPipelineStageListRepository } from './pipeline-stage-list';

const sessionA = { userId: '00000000-0000-4000-8000-000000000001' };
const accountA = '10000000-0000-4000-8000-000000000001';
const pipelineA = '50000000-0000-4000-8000-000000000001';
const stageA = '60000000-0000-4000-8000-000000000001';
const stageRowA = {
  id: stageA,
  pipeline_id: pipelineA,
  pipeline_account_id: accountA,
  name: 'Intake',
  position: 0,
  color: '#3b82f6',
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
  stageRows = [stageRowA],
}: {
  role?: string;
  stageRows?: Record<string, unknown>[];
} = {}) {
  const transactionQuery = vi.fn(
    async (...args: [sql: string, values?: readonly unknown[]]) => {
      const [sql] = args;
      if (sql.includes('set_config')) return { rows: [], rowCount: 1 };
      if (sql.includes('INNER JOIN public.accounts')) {
        return { rows: [{ ...membershipA, role }], rowCount: 1 };
      }
      if (sql.includes('FROM public.pipeline_stages AS ps')) {
        return { rows: stageRows, rowCount: stageRows.length };
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

describe('PostgreSQL pipeline-stage list repository', () => {
  beforeEach(() => {
    mocks.withTransaction.mockReset();
  });

  it('requires a verified session before querying stages', async () => {
    const repository = createPostgresPipelineStageListRepository(
      async () => null
    );

    await expect(repository.listForPipeline(pipelineA)).rejects.toEqual(
      new AppError('unauthorized')
    );
    expect(mocks.withTransaction).not.toHaveBeenCalled();
  });

  it('allows viewers and scopes stages to the verified account and pipeline', async () => {
    const query = setupTransactions();
    const repository = createPostgresPipelineStageListRepository(
      async () => sessionA
    );

    await expect(repository.listForPipeline(pipelineA)).resolves.toEqual([
      {
        id: stageA,
        pipeline_id: pipelineA,
        name: 'Intake',
        position: 0,
        color: '#3b82f6',
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
    expect(sql).toContain('WHERE p.account_id = $1');
    expect(sql).toContain('AND p.id = $2');
    expect(sql).not.toContain('public.profiles AS creator');
    expect(sql).toContain('ORDER BY ps.position ASC, ps.id ASC');
    expect(values).toEqual([accountA, pipelineA]);
  });

  it('returns an empty list when the verified pipeline has no stages', async () => {
    setupTransactions({ stageRows: [] });
    const repository = createPostgresPipelineStageListRepository(
      async () => sessionA
    );

    await expect(repository.listForPipeline(pipelineA)).resolves.toEqual([]);
  });

  it('preserves a null creation timestamp from the legacy schema', async () => {
    setupTransactions({ stageRows: [{ ...stageRowA, created_at: null }] });
    const repository = createPostgresPipelineStageListRepository(
      async () => sessionA
    );

    await expect(repository.listForPipeline(pipelineA)).resolves.toEqual([
      {
        id: stageA,
        pipeline_id: pipelineA,
        name: 'Intake',
        position: 0,
        color: '#3b82f6',
        created_at: null,
      },
    ]);
  });

  it('rejects an invalid pipeline UUID before running its list query', async () => {
    const query = setupTransactions();
    const repository = createPostgresPipelineStageListRepository(
      async () => sessionA
    );

    await expect(repository.listForPipeline('not-a-uuid')).rejects.toEqual(
      new AppError('bad_request')
    );
    expect(
      query.mock.calls.some(([sql]) =>
        sql.includes('FROM public.pipeline_stages AS ps')
      )
    ).toBe(false);
  });

  it('rejects malformed or mismatched parent rows safely', async () => {
    setupTransactions({
      stageRows: [
        {
          ...stageRowA,
          pipeline_id: '50000000-0000-4000-8000-000000000002',
        },
      ],
    });
    const repository = createPostgresPipelineStageListRepository(
      async () => sessionA
    );

    await expect(repository.listForPipeline(pipelineA)).rejects.toEqual(
      new AppError('db_error')
    );

    setupTransactions({ stageRows: [{ ...stageRowA, id: null }] });
    await expect(repository.listForPipeline(pipelineA)).rejects.toEqual(
      new AppError('db_error')
    );

    setupTransactions({
      stageRows: [
        {
          ...stageRowA,
          pipeline_account_id: '10000000-0000-4000-8000-000000000002',
        },
      ],
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
    const repository = createPostgresPipelineStageListRepository(
      async () => sessionA
    );

    await expect(repository.listForPipeline(pipelineA)).rejects.toBe(
      databaseFailure
    );
  });
});
