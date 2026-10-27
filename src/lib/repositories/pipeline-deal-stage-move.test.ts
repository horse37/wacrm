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
import { createPostgresPipelineDealStageMoveRepository } from './pipeline-deal-stage-move';

const sessionA = { userId: '00000000-0000-4000-8000-000000000001' };
const accountA = '10000000-0000-4000-8000-000000000001';
const dealA = '70000000-0000-4000-8000-000000000001';
const stageA = '60000000-0000-4000-8000-000000000001';
const membershipA = {
  userId: sessionA.userId,
  accountId: accountA,
  role: 'agent',
  accountName: 'Synthetic Account A',
};

function setupTransactions({
  role = 'agent',
  updatedRows = [{ id: dealA, stage_id: stageA }],
}: {
  role?: string;
  updatedRows?: Record<string, unknown>[];
} = {}) {
  const transactionQuery = vi.fn(
    async (...args: [sql: string, values?: readonly unknown[]]) => {
      const [sql] = args;
      if (sql.includes('set_config')) return { rows: [], rowCount: 1 };
      if (sql.includes('INNER JOIN public.accounts')) {
        return { rows: [{ ...membershipA, role }], rowCount: 1 };
      }
      if (sql.includes('UPDATE public.deals AS d')) {
        return { rows: updatedRows, rowCount: updatedRows.length };
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

describe('PostgreSQL pipeline deal stage-move repository', () => {
  beforeEach(() => {
    mocks.withTransaction.mockReset();
  });

  it('requires a verified session before opening a transaction', async () => {
    const repository = createPostgresPipelineDealStageMoveRepository(
      async () => null
    );

    await expect(repository.moveToStage(dealA, stageA)).rejects.toEqual(
      new AppError('unauthorized')
    );
    expect(mocks.withTransaction).not.toHaveBeenCalled();
  });

  it('denies viewers before the update query', async () => {
    const query = setupTransactions({ role: 'viewer' });
    const repository = createPostgresPipelineDealStageMoveRepository(
      async () => sessionA
    );

    await expect(repository.moveToStage(dealA, stageA)).rejects.toEqual(
      new AppError('forbidden')
    );
    expect(
      query.mock.calls.some(([sql]) => sql.includes('UPDATE public.deals AS d'))
    ).toBe(false);
  });

  it('validates deal and stage UUIDs before the update query', async () => {
    const query = setupTransactions();
    const repository = createPostgresPipelineDealStageMoveRepository(
      async () => sessionA
    );

    await expect(repository.moveToStage('invalid', stageA)).rejects.toEqual(
      new AppError('bad_request')
    );
    await expect(repository.moveToStage(dealA, 'invalid')).rejects.toEqual(
      new AppError('bad_request')
    );
    expect(
      query.mock.calls.some(([sql]) => sql.includes('UPDATE public.deals AS d'))
    ).toBe(false);
  });

  it('updates only stage_id with bound account, deal and stage IDs', async () => {
    const query = setupTransactions();
    const repository = createPostgresPipelineDealStageMoveRepository(
      async () => sessionA
    );

    await expect(
      repository.moveToStage(dealA, stageA)
    ).resolves.toBeUndefined();

    const update = query.mock.calls.find(([sql]) =>
      sql.includes('UPDATE public.deals AS d')
    );
    expect(update?.[0]).toContain('SET stage_id = $3');
    expect(update?.[0]).toContain('d.account_id = $1');
    expect(update?.[0]).toContain('d.id = $2');
    expect(update?.[0]).toContain('target_stage.pipeline_id = d.pipeline_id');
    expect(update?.[0]).not.toContain('public.profiles AS deal_creator');
    expect(update?.[0]).not.toContain('public.profiles AS pipeline_creator');
    expect(update?.[0]).toContain('p.account_id = d.account_id');
    expect(update?.[1]).toEqual([accountA, dealA, stageA]);
    expect(
      query.mock.calls.some(
        ([sql, values]) =>
          sql === "SELECT set_config('request.jwt.claim.sub', $1, true)" &&
          values?.[0] === sessionA.userId
      )
    ).toBe(true);
  });

  it('returns not found for missing or cross-pipeline targets', async () => {
    setupTransactions({ updatedRows: [] });
    const repository = createPostgresPipelineDealStageMoveRepository(
      async () => sessionA
    );

    await expect(repository.moveToStage(dealA, stageA)).rejects.toEqual(
      new AppError('not_found')
    );
  });

  it('propagates safe database errors without driver details', async () => {
    const databaseFailure = new AppError('db_error');
    mocks.withTransaction
      .mockResolvedValueOnce(dbSuccess(membershipA))
      .mockResolvedValueOnce(dbFailure(databaseFailure));
    const repository = createPostgresPipelineDealStageMoveRepository(
      async () => sessionA
    );

    await expect(repository.moveToStage(dealA, stageA)).rejects.toBe(
      databaseFailure
    );
  });
});
