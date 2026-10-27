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
import { createPostgresAutomationLogFinalizeRepository } from './automation-log-finalize';

const logId = '70000000-0000-4000-8000-000000000001';
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

describe('PostgreSQL automation-log finalize repository', () => {
  beforeEach(() => {
    mocks.withTransaction.mockReset();
  });

  it.each(['success', 'partial', 'failed'] as const)(
    'updates status to %s and explicitly clears an absent error',
    async (status) => {
      const query = setupTransaction();
      const repository = createPostgresAutomationLogFinalizeRepository();

      await expect(
        repository.finalize(writerA, logId, status, null)
      ).resolves.toBe(true);

      expect(mocks.withTransaction).toHaveBeenCalledTimes(1);
      expect(query).toHaveBeenCalledTimes(2);
      expect(query.mock.calls[0][0]).toBe(
        "SELECT set_config('request.jwt.claim.sub', $1, true)"
      );
      expect(query.mock.calls[0][1]).toEqual([writerA.userId]);
      expect(query.mock.calls[1][1]).toEqual([
        logId,
        writerA.accountId,
        writerA.userId,
        status,
        null,
      ]);
      const sql = query.mock.calls[1][0] as string;
      expect(sql).toContain('UPDATE public.automation_logs');
      expect(sql).toMatch(/SET\s+status\s*=\s*\$4,\s*error_message\s*=\s*\$5/i);
      expect(sql).toMatch(
        /WHERE id\s*=\s*\$1\s+AND account_id\s*=\s*\$2\s+AND user_id\s*=\s*\$3/i
      );
      expect(sql).not.toContain('RETURNING *');
    }
  );

  it('writes an explicit error message', async () => {
    const query = setupTransaction();
    const repository = createPostgresAutomationLogFinalizeRepository();

    await expect(
      repository.finalize(writerA, logId, 'failed', 'step execution failed')
    ).resolves.toBe(true);

    expect(query.mock.calls[1][1]).toEqual([
      logId,
      writerA.accountId,
      writerA.userId,
      'failed',
      'step execution failed',
    ]);
  });

  it('returns false when the log ID does not match a row', async () => {
    setupTransaction(0);
    const repository = createPostgresAutomationLogFinalizeRepository();

    await expect(
      repository.finalize(writerA, logId, 'success', null)
    ).resolves.toBe(false);
  });

  it.each([
    ['missing context', undefined],
    ['malformed user ID', { ...writerA, userId: 'invalid' }],
    ['malformed account ID', { ...writerA, accountId: 'invalid' }],
  ])('rejects %s before opening a transaction', async (_label, context) => {
    const repository = createPostgresAutomationLogFinalizeRepository();

    await expect(
      repository.finalize(
        context as Parameters<typeof repository.finalize>[0],
        logId,
        'success',
        null
      )
    ).rejects.toEqual(new AppError('bad_request'));
    expect(mocks.withTransaction).not.toHaveBeenCalled();
  });

  it.each([
    ['malformed UUID', 'invalid', 'success', null],
    ['unknown status', logId, 'running', null],
    ['non-string error', logId, 'failed', { message: 'unsafe' }],
    ['missing error argument', logId, 'success', undefined],
  ])(
    'rejects %s before opening a transaction',
    async (_label, id, status, errorMessage) => {
      const repository = createPostgresAutomationLogFinalizeRepository();

      await expect(
        repository.finalize(
          writerA,
          id as string,
          status as Parameters<typeof repository.finalize>[2],
          errorMessage as Parameters<typeof repository.finalize>[3]
        )
      ).rejects.toEqual(new AppError('bad_request'));
      expect(mocks.withTransaction).not.toHaveBeenCalled();
    }
  );

  it('maps an unexpected update row count to a safe database error', async () => {
    setupTransaction(2);
    const repository = createPostgresAutomationLogFinalizeRepository();

    await expect(
      repository.finalize(writerA, logId, 'failed', 'failed')
    ).rejects.toEqual(new AppError('db_error'));
  });

  it('propagates database failures without driver details', async () => {
    const failure = new AppError('db_error');
    mocks.withTransaction.mockResolvedValueOnce(dbFailure(failure));
    const repository = createPostgresAutomationLogFinalizeRepository();

    await expect(
      repository.finalize(writerA, logId, 'success', null)
    ).rejects.toBe(failure);
  });
});
