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
import { createPostgresAutomationPendingFinalizeRepository } from './automation-pending-finalize';

const executionId = '40000000-0000-4000-8000-000000000001';
const writerA = {
  userId: '30000000-0000-4000-8000-000000000001',
  accountId: '20000000-0000-4000-8000-000000000001',
};

function setupTransaction(rowCount = 1) {
  const query = vi.fn().mockResolvedValue({ rows: [], rowCount });
  const transaction = { query } as unknown as DbTransaction;

  mocks.withTransaction.mockImplementation(async (operation) => {
    try {
      return dbSuccess(await operation(transaction));
    } catch (error) {
      return dbFailure(toAppError(error));
    }
  });

  return query;
}

describe('PostgreSQL automation pending-execution finalize repository', () => {
  beforeEach(() => {
    mocks.withTransaction.mockReset();
  });

  it.each(['done', 'failed'] as const)(
    'transitions a running execution to %s with a guarded, parameterized update',
    async (status) => {
      const query = setupTransaction(1);
      const repository = createPostgresAutomationPendingFinalizeRepository();

      await expect(
        repository.finalize(writerA, executionId, status)
      ).resolves.toBe(true);

      expect(mocks.withTransaction).toHaveBeenCalledTimes(1);
      expect(query).toHaveBeenCalledTimes(2);
      expect(query.mock.calls[0][0]).toBe(
        "SELECT set_config('request.jwt.claim.sub', $1, true)"
      );
      expect(query.mock.calls[0][1]).toEqual([writerA.userId]);
      expect(query.mock.calls[1][1]).toEqual([
        executionId,
        writerA.accountId,
        writerA.userId,
        status,
      ]);
      const sql = query.mock.calls[1][0] as string;
      expect(sql).toContain('UPDATE public.automation_pending_executions');
      expect(sql).toMatch(/SET\s+status\s*=\s*\$4/i);
      expect(sql).toMatch(/WHERE\s+id\s*=\s*\$1/i);
      expect(sql).toMatch(/account_id\s*=\s*\$2\s+AND\s+user_id\s*=\s*\$3/i);
      expect(sql).toContain("status = 'running'");
      expect(sql).not.toContain('RETURNING *');
    }
  );

  it('returns false when the ID is missing or no longer running', async () => {
    setupTransaction(0);
    const repository = createPostgresAutomationPendingFinalizeRepository();

    await expect(
      repository.finalize(writerA, executionId, 'done')
    ).resolves.toBe(false);
  });

  it.each([
    ['missing context', undefined, executionId, 'done'],
    [
      'malformed user ID',
      { ...writerA, userId: 'invalid' },
      executionId,
      'done',
    ],
    [
      'malformed account ID',
      { ...writerA, accountId: 'invalid' },
      executionId,
      'done',
    ],
  ])(
    'rejects %s before opening a transaction',
    async (_label, context, id, status) => {
      const repository = createPostgresAutomationPendingFinalizeRepository();

      await expect(
        repository.finalize(
          context as Parameters<typeof repository.finalize>[0],
          id as string,
          status as 'done' | 'failed'
        )
      ).rejects.toEqual(new AppError('bad_request'));
      expect(mocks.withTransaction).not.toHaveBeenCalled();
    }
  );

  it.each([
    ['malformed UUID', 'not-a-uuid', 'done'],
    ['unsupported status', executionId, 'pending'],
  ])(
    'rejects invalid %s before opening a transaction',
    async (_label, id, status) => {
      const repository = createPostgresAutomationPendingFinalizeRepository();

      await expect(
        repository.finalize(writerA, id as string, status as 'done' | 'failed')
      ).rejects.toEqual(new AppError('bad_request'));
      expect(mocks.withTransaction).not.toHaveBeenCalled();
    }
  );

  it('maps an invalid update row count to a safe database error', async () => {
    setupTransaction(2);
    const repository = createPostgresAutomationPendingFinalizeRepository();

    await expect(
      repository.finalize(writerA, executionId, 'failed')
    ).rejects.toEqual(new AppError('db_error'));
  });

  it('propagates database failures without driver details', async () => {
    const failure = new AppError('db_error');
    mocks.withTransaction.mockResolvedValueOnce(dbFailure(failure));
    const repository = createPostgresAutomationPendingFinalizeRepository();

    await expect(
      repository.finalize(writerA, executionId, 'done')
    ).rejects.toBe(failure);
  });
});
