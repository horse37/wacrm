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
import {
  createPostgresAutomationPendingScheduleRepository,
  type AutomationPendingScheduleInput,
} from './automation-pending-schedule';

const validInput = {
  automationId: '30000000-0000-4000-8000-000000000001',
  contactId: '50000000-0000-4000-8000-000000000001',
  logId: '60000000-0000-4000-8000-000000000001',
  parentStepId: '70000000-0000-4000-8000-000000000001',
  branch: 'yes' as const,
  nextStepPosition: 4,
  context: { message_text: 'Synthetic only', vars: { source: 'fixture' } },
  runAt: new Date('2026-10-20T12:00:00.000Z'),
};
const writerContext = {
  userId: '00000000-0000-4000-8000-000000000001',
  accountId: '10000000-0000-4000-8000-000000000001',
};

function setupTransaction(
  rows = [{ id: '40000000-0000-4000-8000-000000000001' }]
) {
  const query = vi.fn(
    async (...args: [sql: string, values?: readonly unknown[]]) => {
      const [sql] = args;
      if (sql.includes('set_config')) return { rows: [], rowCount: 1 };
      return { rows, rowCount: rows.length };
    }
  );
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

describe('PostgreSQL automation pending-execution schedule repository', () => {
  beforeEach(() => {
    mocks.withTransaction.mockReset();
  });

  it('inserts a pending execution and returns only the generated UUID', async () => {
    const query = setupTransaction();
    const repository = createPostgresAutomationPendingScheduleRepository();

    await expect(repository.schedule(writerContext, validInput)).resolves.toBe(
      '40000000-0000-4000-8000-000000000001'
    );

    expect(mocks.withTransaction).toHaveBeenCalledTimes(1);
    expect(query).toHaveBeenCalledTimes(2);
    expect(query.mock.calls[0]).toEqual([
      "SELECT set_config('request.jwt.claim.sub', $1, true)",
      [writerContext.userId],
    ]);
    expect(query.mock.calls[1][1]).toEqual([
      validInput.automationId,
      writerContext.accountId,
      writerContext.userId,
      validInput.contactId,
      validInput.logId,
      validInput.parentStepId,
      validInput.branch,
      validInput.nextStepPosition,
      validInput.context,
      validInput.runAt,
    ]);
    const sql = query.mock.calls[1][0] as string;
    expect(sql).toContain('INSERT INTO public.automation_pending_executions');
    expect(sql).toContain("'pending'");
    expect(sql).toContain('RETURNING id::text AS id');
    expect(sql).not.toMatch(/INSERT[\s\S]*\bid\s*,/i);
    expect(sql).not.toContain('RETURNING *');
  });

  it('stores an empty context when the caller omits it', async () => {
    const query = setupTransaction();
    const repository = createPostgresAutomationPendingScheduleRepository();
    const input = { ...validInput };
    Reflect.deleteProperty(input, 'context');

    await expect(repository.schedule(writerContext, input)).resolves.toBe(
      '40000000-0000-4000-8000-000000000001'
    );
    expect(query.mock.calls[1]?.[1]?.[8]).toEqual({});
  });

  it('uses trusted writer identity when payload includes forged tenant fields', async () => {
    const query = setupTransaction();
    const repository = createPostgresAutomationPendingScheduleRepository();
    const forgedInput = {
      ...validInput,
      accountId: '10000000-0000-4000-8000-000000000099',
      userId: '00000000-0000-4000-8000-000000000099',
    } as AutomationPendingScheduleInput;

    await repository.schedule(writerContext, forgedInput);

    expect(query.mock.calls[1][1]).toEqual([
      validInput.automationId,
      writerContext.accountId,
      writerContext.userId,
      validInput.contactId,
      validInput.logId,
      validInput.parentStepId,
      validInput.branch,
      validInput.nextStepPosition,
      validInput.context,
      validInput.runAt,
    ]);
  });

  it.each([
    ['input object', null],
    ['automation UUID', { ...validInput, automationId: 'invalid' }],
    ['optional UUID', { ...validInput, contactId: 'invalid' }],
    ['branch', { ...validInput, branch: 'sideways' }],
    ['step position', { ...validInput, nextStepPosition: -1 }],
    ['fractional step position', { ...validInput, nextStepPosition: 1.5 }],
    ['run time', { ...validInput, runAt: new Date(Number.NaN) }],
    ['run time type', { ...validInput, runAt: 42 }],
    ['context object', { ...validInput, context: [] }],
    [
      'context string field',
      { ...validInput, context: { message_text: { invalid: true } } },
    ],
    ['context vars', { ...validInput, context: { vars: 'invalid' } }],
  ] as Array<[string, unknown]>)(
    'rejects invalid %s before querying',
    async (_label, input) => {
      const repository = createPostgresAutomationPendingScheduleRepository();

      await expect(
        repository.schedule(
          writerContext,
          input as AutomationPendingScheduleInput
        )
      ).rejects.toEqual(new AppError('bad_request'));
      expect(mocks.withTransaction).not.toHaveBeenCalled();
    }
  );

  it.each([
    ['missing writer context', null],
    ['invalid user UUID', { ...writerContext, userId: 'invalid' }],
    ['invalid account UUID', { ...writerContext, accountId: 'invalid' }],
  ])('rejects %s before opening a transaction', async (_label, writer) => {
    const repository = createPostgresAutomationPendingScheduleRepository();

    await expect(
      repository.schedule(writer as typeof writerContext, validInput)
    ).rejects.toEqual(new AppError('bad_request'));
    expect(mocks.withTransaction).not.toHaveBeenCalled();
  });

  it('rejects a malformed generated identifier as a safe database error', async () => {
    setupTransaction([{ id: 'not-a-uuid' }]);
    const repository = createPostgresAutomationPendingScheduleRepository();

    await expect(
      repository.schedule(writerContext, validInput)
    ).rejects.toEqual(new AppError('db_error'));
  });

  it('propagates database failures without driver details', async () => {
    const failure = new AppError('db_error');
    mocks.withTransaction.mockResolvedValueOnce(dbFailure(failure));
    const repository = createPostgresAutomationPendingScheduleRepository();

    await expect(repository.schedule(writerContext, validInput)).rejects.toBe(
      failure
    );
  });
});
