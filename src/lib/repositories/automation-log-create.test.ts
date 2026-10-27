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
import type { AutomationLogWriterContext } from './automation-log-append';
import {
  createPostgresAutomationLogCreateRepository,
  type AutomationLogCreateInput,
} from './automation-log-create';

const validInput: AutomationLogCreateInput = {
  automationId: '30000000-0000-4000-8000-000000000001',
  contactId: '50000000-0000-4000-8000-000000000001',
  triggerEvent: 'new_message_received',
};
const writerA: AutomationLogWriterContext = {
  userId: '00000000-0000-4000-8000-000000000001',
  accountId: '10000000-0000-4000-8000-000000000001',
};
const generatedId = '40000000-0000-4000-8000-000000000001';

function setupTransaction(rows: unknown[] = [{ id: generatedId }]) {
  const query = vi.fn().mockResolvedValue({ rows, rowCount: rows.length });
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

describe('PostgreSQL automation-log creation repository', () => {
  beforeEach(() => {
    mocks.withTransaction.mockReset();
  });

  it('inserts an initial successful log and returns only its generated UUID', async () => {
    const query = setupTransaction();
    const repository = createPostgresAutomationLogCreateRepository();

    await expect(repository.create(writerA, validInput)).resolves.toBe(
      generatedId
    );

    expect(mocks.withTransaction).toHaveBeenCalledTimes(1);
    expect(query).toHaveBeenCalledTimes(2);
    expect(query.mock.calls[0][0]).toBe(
      "SELECT set_config('request.jwt.claim.sub', $1, true)"
    );
    expect(query.mock.calls[0][1]).toEqual([writerA.userId]);
    expect(query.mock.calls[1][1]).toEqual([
      validInput.automationId,
      writerA.accountId,
      writerA.userId,
      validInput.contactId,
      validInput.triggerEvent,
    ]);
    const sql = query.mock.calls[1][0] as string;
    expect(sql).toContain('INSERT INTO public.automation_logs');
    expect(sql).toContain("'[]'::jsonb");
    expect(sql).toContain("'success'");
    expect(sql).toContain('RETURNING id::text AS id');
    expect(sql).not.toMatch(/INSERT[\s\S]*\bid\s*,/i);
    expect(sql).not.toContain('RETURNING *');
  });

  it('supports an execution without a contact', async () => {
    const query = setupTransaction();
    const repository = createPostgresAutomationLogCreateRepository();

    await expect(
      repository.create(writerA, { ...validInput, contactId: null })
    ).resolves.toBe(generatedId);
    expect(query.mock.calls[1][1]).toEqual([
      validInput.automationId,
      writerA.accountId,
      writerA.userId,
      null,
      validInput.triggerEvent,
    ]);
  });

  it('uses trusted tenant and owner even if payload includes legacy identity fields', async () => {
    const query = setupTransaction();
    const repository = createPostgresAutomationLogCreateRepository();
    const payloadWithUntrustedIdentity = {
      ...validInput,
      accountId: '10000000-0000-4000-8000-000000000002',
      userId: '00000000-0000-4000-8000-000000000002',
    };

    await expect(
      repository.create(
        writerA,
        payloadWithUntrustedIdentity as AutomationLogCreateInput
      )
    ).resolves.toBe(generatedId);

    expect(query.mock.calls[1][1]).toEqual([
      validInput.automationId,
      writerA.accountId,
      writerA.userId,
      validInput.contactId,
      validInput.triggerEvent,
    ]);
  });

  it.each([
    ['not an object', null],
    ['automation UUID', { ...validInput, automationId: 'invalid' }],
    ['contact UUID', { ...validInput, contactId: 'invalid' }],
    ['trigger event', { ...validInput, triggerEvent: 'unknown-trigger' }],
  ])(
    'rejects invalid %s before opening a transaction',
    async (_label, input) => {
      const repository = createPostgresAutomationLogCreateRepository();

      await expect(
        repository.create(
          writerA,
          input as Parameters<typeof repository.create>[1]
        )
      ).rejects.toEqual(new AppError('bad_request'));
      expect(mocks.withTransaction).not.toHaveBeenCalled();
    }
  );

  it.each([
    { label: 'missing row', rows: [] },
    { label: 'null ID', rows: [{ id: null }] },
    { label: 'malformed UUID', rows: [{ id: 'not-a-uuid' }] },
  ])(
    'maps a $label generated-ID result to a safe database error',
    async ({ rows }) => {
      setupTransaction(rows);
      const repository = createPostgresAutomationLogCreateRepository();

      await expect(repository.create(writerA, validInput)).rejects.toEqual(
        new AppError('db_error')
      );
    }
  );

  it('propagates database failures without driver details', async () => {
    const failure = new AppError('db_error');
    mocks.withTransaction.mockResolvedValueOnce(dbFailure(failure));
    const repository = createPostgresAutomationLogCreateRepository();

    await expect(repository.create(writerA, validInput)).rejects.toBe(failure);
  });

  it.each([
    ['not an object', null],
    ['user UUID', { ...writerA, userId: 'invalid' }],
    ['account UUID', { ...writerA, accountId: 'invalid' }],
  ])(
    'rejects invalid writer context %s before opening a transaction',
    async (_label, writerContext) => {
      const repository = createPostgresAutomationLogCreateRepository();

      await expect(
        repository.create(
          writerContext as AutomationLogWriterContext,
          validInput
        )
      ).rejects.toEqual(new AppError('bad_request'));
      expect(mocks.withTransaction).not.toHaveBeenCalled();
    }
  );
});
