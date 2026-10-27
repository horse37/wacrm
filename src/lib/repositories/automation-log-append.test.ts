import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AppError, dbFailure, dbSuccess, toAppError } from '../db/errors';
import type { AutomationLogStepResult } from '../../types';

const mocks = vi.hoisted(() => ({
  withTransaction: vi.fn(),
}));

vi.mock('server-only', () => ({}));
vi.mock('../db/postgres-client', () => ({
  withTransaction: mocks.withTransaction,
}));

import type { DbTransaction } from '../db/postgres-client';
import { createPostgresAutomationLogAppendRepository } from './automation-log-append';

const logId = '40000000-0000-4000-8000-000000000001';
const writer = {
  userId: '30000000-0000-4000-8000-000000000001',
  accountId: '20000000-0000-4000-8000-000000000001',
};
const firstStep = {
  step_id: '50000000-0000-4000-8000-000000000001',
  step_type: 'send_message',
  status: 'success',
  detail: 'sent',
} satisfies AutomationLogStepResult;
const secondStep = {
  step_id: '50000000-0000-4000-8000-000000000002',
  step_type: 'add_tag',
  status: 'skipped',
} satisfies AutomationLogStepResult;

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

describe('PostgreSQL automation-log append repository', () => {
  beforeEach(() => {
    mocks.withTransaction.mockReset();
  });

  it('atomically appends projected step results and applies supplied status/error', async () => {
    const query = setupTransaction();
    const repository = createPostgresAutomationLogAppendRepository();

    await expect(
      repository.append(
        writer,
        logId,
        [
          {
            ...firstStep,
            ignored: 'private field',
          } as unknown as AutomationLogStepResult,
        ],
        'partial',
        'one step failed'
      )
    ).resolves.toBe(true);

    expect(mocks.withTransaction).toHaveBeenCalledTimes(1);
    expect(query).toHaveBeenCalledTimes(2);
    expect(query.mock.calls[0]).toEqual([
      "SELECT set_config('request.jwt.claim.sub', $1, true)",
      [writer.userId],
    ]);
    expect(query.mock.calls[1][1]).toEqual([
      logId,
      writer.accountId,
      writer.userId,
      JSON.stringify([firstStep]),
      'partial',
      true,
      'one step failed',
    ]);
    const sql = query.mock.calls[1][0] as string;
    expect(sql).toContain('UPDATE public.automation_logs');
    expect(sql).toMatch(
      /steps_executed\s*=\s*steps_executed\s*\|\|\s*\$4::jsonb/i
    );
    expect(sql).toMatch(/status\s*=\s*COALESCE\(\$5::text,\s*status\)/i);
    expect(sql).toMatch(
      /CASE\s+WHEN \$6::boolean THEN \$7::text\s+ELSE error_message\s+END/i
    );
    expect(sql).toMatch(/WHERE id\s*=\s*\$1/i);
    expect(sql).toMatch(/AND account_id\s*=\s*\$2/i);
    expect(sql).toMatch(/AND user_id\s*=\s*\$3/i);
    expect(sql).toContain("jsonb_typeof(steps_executed) = 'array'");
    expect(sql).not.toContain('RETURNING *');
  });

  it('appends in order and preserves status/error for null or empty optional values', async () => {
    const query = setupTransaction();
    const repository = createPostgresAutomationLogAppendRepository();

    await expect(
      repository.append(writer, logId, [secondStep, firstStep], null, '')
    ).resolves.toBe(true);

    expect(query.mock.calls[1][1]).toEqual([
      logId,
      writer.accountId,
      writer.userId,
      JSON.stringify([secondStep, firstStep]),
      null,
      false,
      null,
    ]);
    const sql = query.mock.calls[1][0] as string;
    expect(sql.indexOf('steps_executed =')).toBeLessThan(
      sql.indexOf('status =')
    );
    expect(sql).toMatch(/ELSE error_message\s+END/i);
  });

  it('allows an empty append to update only supplied outer fields', async () => {
    const query = setupTransaction();
    const repository = createPostgresAutomationLogAppendRepository();

    await expect(repository.append(writer, logId, [], 'success')).resolves.toBe(
      true
    );

    expect(query.mock.calls[1][1]).toEqual([
      logId,
      writer.accountId,
      writer.userId,
      '[]',
      'success',
      false,
      null,
    ]);
  });

  it('returns false when no row with an array of results matches', async () => {
    setupTransaction(0);
    const repository = createPostgresAutomationLogAppendRepository();

    await expect(repository.append(writer, logId, [firstStep])).resolves.toBe(
      false
    );
  });

  it('rejects sparse result arrays before opening a transaction', async () => {
    const repository = createPostgresAutomationLogAppendRepository();
    const sparseResults = new Array(1) as AutomationLogStepResult[];

    await expect(
      repository.append(writer, logId, sparseResults)
    ).rejects.toEqual(new AppError('bad_request'));
    expect(mocks.withTransaction).not.toHaveBeenCalled();
  });

  it.each([
    ['missing writer context', undefined, logId, [firstStep], null, null],
    [
      'malformed writer user UUID',
      { ...writer, userId: 'invalid' },
      logId,
      [firstStep],
      null,
      null,
    ],
    [
      'malformed writer account UUID',
      { ...writer, accountId: 'invalid' },
      logId,
      [firstStep],
      null,
      null,
    ],
    ['malformed log UUID', writer, 'invalid', [firstStep], null, null],
    ['non-array results', writer, logId, null, null, null],
    [
      'malformed step UUID',
      writer,
      logId,
      [{ ...firstStep, step_id: 'invalid' }],
      null,
      null,
    ],
    [
      'unknown step type',
      writer,
      logId,
      [{ ...firstStep, step_type: 'unknown' }],
      null,
      null,
    ],
    [
      'unknown step result status',
      writer,
      logId,
      [{ ...firstStep, status: 'running' }],
      null,
      null,
    ],
    [
      'non-string detail',
      writer,
      logId,
      [{ ...firstStep, detail: 42 }],
      null,
      null,
    ],
    ['unknown outer status', writer, logId, [firstStep], 'running', null],
    [
      'non-string error',
      writer,
      logId,
      [firstStep],
      null,
      { message: 'unsafe' },
    ],
  ])(
    'rejects %s before opening a transaction',
    async (_label, context, id, results, status, errorMessage) => {
      const repository = createPostgresAutomationLogAppendRepository();

      await expect(
        repository.append(
          context as Parameters<typeof repository.append>[0],
          id as string,
          results as Parameters<typeof repository.append>[2],
          status as Parameters<typeof repository.append>[3],
          errorMessage as Parameters<typeof repository.append>[4]
        )
      ).rejects.toEqual(new AppError('bad_request'));
      expect(mocks.withTransaction).not.toHaveBeenCalled();
    }
  );

  it('maps an invalid update row count to a safe database error', async () => {
    setupTransaction(2);
    const repository = createPostgresAutomationLogAppendRepository();

    await expect(repository.append(writer, logId, [firstStep])).rejects.toEqual(
      new AppError('db_error')
    );
  });

  it('propagates database failures without driver details', async () => {
    const failure = new AppError('db_error');
    mocks.withTransaction.mockResolvedValueOnce(dbFailure(failure));
    const repository = createPostgresAutomationLogAppendRepository();

    await expect(repository.append(writer, logId, [firstStep])).rejects.toBe(
      failure
    );
  });
});
