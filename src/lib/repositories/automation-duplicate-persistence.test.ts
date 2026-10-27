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
import { createPostgresAutomationDuplicatePersistenceRepository } from './automation-duplicate-persistence';

const sessionA = { userId: '00000000-0000-4000-8000-000000000003' };
const accountA = '10000000-0000-4000-8000-000000000001';
const sourceAutomationA = '30000000-0000-4000-8000-000000000001';
const copiedAutomationA = '30000000-0000-4000-8000-000000000101';
const sourceRootStepA = '40000000-0000-4000-8000-000000000001';
const sourceChildStepA = '40000000-0000-4000-8000-000000000002';
const copiedRootStepA = '40000000-0000-4000-8000-000000000101';
const copiedChildStepA = '40000000-0000-4000-8000-000000000102';
const membershipA = {
  userId: sessionA.userId,
  accountId: accountA,
  role: 'agent',
  accountName: 'Synthetic Account A',
};
const sourceAutomationRow = {
  id: sourceAutomationA,
  user_id: sessionA.userId,
  account_id: accountA,
  name: 'Synthetic automation',
  description: 'Synthetic description',
  trigger_type: 'new_message_received',
  trigger_config: { keywords: ['synthetic'] },
};
const sourceSteps = [
  {
    id: sourceRootStepA,
    parent_step_id: null,
    branch: null,
    step_type: 'condition',
    step_config: { field: 'message' },
    position: 0,
  },
  {
    id: sourceChildStepA,
    parent_step_id: sourceRootStepA,
    branch: 'yes',
    step_type: 'send_message',
    step_config: { text: 'Synthetic reply' },
    position: 1,
  },
];

function setupTransactions({
  role = 'agent',
  sourceRows = [sourceAutomationRow],
  stepRows = sourceSteps,
  failStepInsert = false,
}: {
  role?: string;
  sourceRows?: Record<string, unknown>[];
  stepRows?: Record<string, unknown>[];
  failStepInsert?: boolean;
} = {}) {
  const transactionQuery = vi.fn(
    async (...args: [sql: string, values?: readonly unknown[]]) => {
      const [sql, values] = args;
      if (sql === 'SET TRANSACTION ISOLATION LEVEL REPEATABLE READ') {
        return { rows: [], rowCount: 0 };
      }
      if (sql.includes('set_config')) return { rows: [], rowCount: 1 };
      if (sql.includes('INNER JOIN public.accounts')) {
        return { rows: [{ ...membershipA, role }], rowCount: 1 };
      }
      if (sql.includes('FROM public.automations AS automation')) {
        return { rows: sourceRows, rowCount: sourceRows.length };
      }
      if (sql.includes('FROM public.automation_steps AS step')) {
        return { rows: stepRows, rowCount: stepRows.length };
      }
      if (sql.includes('INSERT INTO public.automations')) {
        const [id, userId, accountId, name, description, triggerType, config] =
          values ?? [];
        return {
          rows: [
            {
              id,
              user_id: userId,
              account_id: accountId,
              name,
              description,
              trigger_type: triggerType,
              trigger_config: JSON.parse(String(config)),
              is_active: false,
              execution_count: 0,
              last_executed_at: null,
              created_at: new Date('2026-10-20T00:00:00.000Z'),
              updated_at: new Date('2026-10-20T00:00:00.000Z'),
            },
          ],
          rowCount: 1,
        };
      }
      if (sql.includes('jsonb_to_recordset')) {
        if (failStepInsert) throw new Error('synthetic step insert failure');
        const copiedRows = JSON.parse(String(values?.[0])) as Array<{
          id: string;
        }>;
        return {
          rows: copiedRows.map(({ id }) => ({ id })),
          rowCount: copiedRows.length,
        };
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

function idSequence(...ids: string[]) {
  return () => {
    const id = ids.shift();
    if (!id) throw new Error('Synthetic ID sequence exhausted');
    return id;
  };
}

function repository(
  generateId: () => string = idSequence(
    copiedAutomationA,
    copiedRootStepA,
    copiedChildStepA
  )
) {
  return createPostgresAutomationDuplicatePersistenceRepository(
    async () => sessionA,
    generateId
  );
}

describe('PostgreSQL automation-duplicate persistence repository', () => {
  beforeEach(() => {
    mocks.withTransaction.mockReset();
  });

  it('requires a verified session before opening a duplicate transaction', async () => {
    const repository = createPostgresAutomationDuplicatePersistenceRepository(
      async () => null
    );

    await expect(
      repository.duplicateOwnedAutomation(sourceAutomationA)
    ).rejects.toEqual(new AppError('unauthorized'));
    expect(mocks.withTransaction).not.toHaveBeenCalled();
  });

  it('denies viewers before inserting an automation', async () => {
    const query = setupTransactions({ role: 'viewer' });

    await expect(
      repository().duplicateOwnedAutomation(sourceAutomationA)
    ).rejects.toEqual(new AppError('forbidden'));
    expect(
      query.mock.calls.some(([sql]) =>
        sql.includes('INSERT INTO public.automations')
      )
    ).toBe(false);
  });

  it('validates the source UUID before issuing source or insert SQL', async () => {
    const query = setupTransactions();

    await expect(
      repository().duplicateOwnedAutomation('not-an-automation-id')
    ).rejects.toEqual(new AppError('bad_request'));
    expect(
      query.mock.calls.some(
        ([sql]) =>
          sql.includes('FROM public.automations AS automation') ||
          sql.includes('INSERT INTO public.automations')
      )
    ).toBe(false);
  });

  it('returns not found for missing or non-owned source automation', async () => {
    setupTransactions({ sourceRows: [] });

    await expect(
      repository().duplicateOwnedAutomation(sourceAutomationA)
    ).rejects.toEqual(new AppError('not_found'));
  });

  it('copies only verified source metadata and remaps every step parent in one transaction', async () => {
    const query = setupTransactions();
    const duplicateRepository = repository();

    const copy =
      await duplicateRepository.duplicateOwnedAutomation(sourceAutomationA);

    expect(copy).toMatchObject({
      id: copiedAutomationA,
      user_id: sessionA.userId,
      account_id: accountA,
      name: 'Synthetic automation (Copy)',
      description: 'Synthetic description',
      trigger_type: 'new_message_received',
      trigger_config: { keywords: ['synthetic'] },
      is_active: false,
      execution_count: 0,
      last_executed_at: null,
    });
    const sourceRead = query.mock.calls.find(([sql]) =>
      sql.includes('FROM public.automations AS automation')
    );
    expect(sourceRead?.[0]).toContain('automation.id = $2');
    expect(sourceRead?.[0]).toContain('automation.user_id = $3');
    expect(sourceRead?.[0]).toContain('automation.account_id = $1');
    expect(sourceRead?.[0]).not.toMatch(/\bFOR\s+UPDATE\b/i);
    expect(sourceRead?.[1]).toEqual([
      accountA,
      sourceAutomationA,
      sessionA.userId,
    ]);
    const isolation = query.mock.calls.findIndex(
      ([sql]) => sql === 'SET TRANSACTION ISOLATION LEVEL REPEATABLE READ'
    );
    const sourceReadIndex = query.mock.calls.findIndex(([sql]) =>
      sql.includes('FROM public.automations AS automation')
    );
    const identityIndex = query.mock.calls.findIndex(
      ([sql], index) => index > isolation && sql.includes('set_config')
    );
    expect(isolation).toBeGreaterThan(-1);
    expect(identityIndex).toBeGreaterThan(isolation);
    expect(isolation).toBeLessThan(sourceReadIndex);

    const insert = query.mock.calls.find(([sql]) =>
      sql.includes('INSERT INTO public.automations')
    );
    expect(insert?.[1]).toEqual([
      copiedAutomationA,
      sessionA.userId,
      accountA,
      'Synthetic automation (Copy)',
      'Synthetic description',
      'new_message_received',
      JSON.stringify({ keywords: ['synthetic'] }),
    ]);

    const stepInsert = query.mock.calls.find(([sql]) =>
      sql.includes('jsonb_to_recordset')
    );
    const copiedSteps = JSON.parse(String(stepInsert?.[1]?.[0]));
    expect(copiedSteps).toEqual([
      {
        id: copiedRootStepA,
        automation_id: copiedAutomationA,
        parent_step_id: null,
        branch: null,
        step_type: 'condition',
        step_config: { field: 'message' },
        position: 0,
      },
      {
        id: copiedChildStepA,
        automation_id: copiedAutomationA,
        parent_step_id: copiedRootStepA,
        branch: 'yes',
        step_type: 'send_message',
        step_config: { text: 'Synthetic reply' },
        position: 1,
      },
    ]);

    const identity = query.mock.calls.find(([sql]) =>
      sql.includes('set_config')
    );
    expect(identity?.[0]).toBe(
      "SELECT set_config('request.jwt.claim.sub', $1, true)"
    );
  });

  it('skips child insert for an automation with no steps', async () => {
    const query = setupTransactions({ stepRows: [] });

    await repository(idSequence(copiedAutomationA)).duplicateOwnedAutomation(
      sourceAutomationA
    );

    expect(
      query.mock.calls.some(([sql]) => sql.includes('jsonb_to_recordset'))
    ).toBe(false);
  });

  it('fails closed before parent insertion when a step parent is outside the source graph', async () => {
    const query = setupTransactions({
      stepRows: [
        {
          ...sourceSteps[1],
          parent_step_id: '40000000-0000-4000-8000-000000000099',
        },
      ],
    });

    await expect(
      repository().duplicateOwnedAutomation(sourceAutomationA)
    ).rejects.toEqual(new AppError('db_error'));
    expect(
      query.mock.calls.some(([sql]) =>
        sql.includes('INSERT INTO public.automations')
      )
    ).toBe(false);
  });

  it('rolls back the parent copy when the step insert fails', async () => {
    const query = setupTransactions({ failStepInsert: true });

    await expect(
      repository().duplicateOwnedAutomation(sourceAutomationA)
    ).rejects.toEqual(new AppError('db_error'));
    const statements = query.mock.calls.map(([sql]) => sql);
    expect(
      statements.findIndex((sql) =>
        sql.includes('INSERT INTO public.automations')
      )
    ).toBeGreaterThan(-1);
    expect(
      statements.findIndex((sql) => sql.includes('jsonb_to_recordset'))
    ).toBeGreaterThan(
      statements.findIndex((sql) =>
        sql.includes('INSERT INTO public.automations')
      )
    );
  });

  it('fails closed if generated UUIDs are invalid or duplicate', async () => {
    const invalidQuery = setupTransactions();
    await expect(
      repository(idSequence('bad-id')).duplicateOwnedAutomation(
        sourceAutomationA
      )
    ).rejects.toEqual(new AppError('db_error'));
    expect(
      invalidQuery.mock.calls.some(([sql]) =>
        sql.includes('INSERT INTO public.automations')
      )
    ).toBe(false);

    const duplicateQuery = setupTransactions();
    await expect(
      repository(
        idSequence(copiedAutomationA, copiedRootStepA, copiedRootStepA)
      ).duplicateOwnedAutomation(sourceAutomationA)
    ).rejects.toEqual(new AppError('db_error'));
    expect(
      duplicateQuery.mock.calls.some(([sql]) =>
        sql.includes('INSERT INTO public.automations')
      )
    ).toBe(false);
  });
});
