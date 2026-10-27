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
import { createPostgresAutomationCreatePersistenceRepository } from './automation-create-persistence';

const sessionA = { userId: '00000000-0000-4000-8000-000000000003' };
const accountA = '10000000-0000-4000-8000-000000000001';
const automationId = '30000000-0000-4000-8000-000000000101';
const rootStepId = '40000000-0000-4000-8000-000000000101';
const childStepId = '40000000-0000-4000-8000-000000000102';
const membershipA = {
  userId: sessionA.userId,
  accountId: accountA,
  role: 'agent',
  accountName: 'Synthetic Account A',
};

const validActiveInput = {
  name: 'Synthetic active automation',
  description: 'Synthetic description',
  trigger_type: 'keyword_match',
  trigger_config: { keywords: ['hello'], match_type: 'contains' },
  is_active: true,
  steps: [
    {
      step_type: 'send_message',
      step_config: { text: 'Synthetic reply' },
    },
  ],
};

function idSequence(...ids: string[]) {
  return () => {
    const id = ids.shift();
    if (!id) throw new Error('Synthetic ID sequence exhausted');
    return id;
  };
}

function setupTransactions({
  role = 'agent',
  failStepInsert = false,
}: { role?: string; failStepInsert?: boolean } = {}) {
  const transactionQuery = vi.fn(
    async (...args: [sql: string, values?: readonly unknown[]]) => {
      const [sql, values] = args;
      if (sql.includes('set_config')) return { rows: [], rowCount: 1 };
      if (sql.includes('INNER JOIN public.accounts')) {
        return { rows: [{ ...membershipA, role }], rowCount: 1 };
      }
      if (sql.includes('INSERT INTO public.automations')) {
        const [
          id,
          userId,
          accountId,
          name,
          description,
          triggerType,
          config,
          active,
        ] = values ?? [];
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
              is_active: active,
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

function repository(
  generateId = idSequence(automationId, rootStepId, childStepId)
) {
  return createPostgresAutomationCreatePersistenceRepository(
    async () => sessionA,
    generateId
  );
}

describe('PostgreSQL automation-create persistence repository', () => {
  beforeEach(() => {
    mocks.withTransaction.mockReset();
  });

  it('requires a verified session before opening a creation transaction', async () => {
    const createRepository =
      createPostgresAutomationCreatePersistenceRepository(async () => null);

    await expect(
      createRepository.createAutomation({ ...validActiveInput })
    ).rejects.toEqual(new AppError('unauthorized'));
    expect(mocks.withTransaction).not.toHaveBeenCalled();
  });

  it('denies viewers before inserting an automation', async () => {
    const query = setupTransactions({ role: 'viewer' });

    await expect(
      repository().createAutomation({ ...validActiveInput })
    ).rejects.toEqual(new AppError('forbidden'));
    expect(
      query.mock.calls.some(([sql]) =>
        sql.includes('INSERT INTO public.automations')
      )
    ).toBe(false);
  });

  it('rejects missing required metadata before issuing insert SQL', async () => {
    const query = setupTransactions();

    await expect(
      repository().createAutomation({
        ...validActiveInput,
        name: '',
      })
    ).rejects.toEqual(new AppError('bad_request'));
    expect(
      query.mock.calls.some(([sql]) =>
        sql.includes('INSERT INTO public.automations')
      )
    ).toBe(false);
  });

  it('persists a valid active tree with guard-derived identity in one transaction', async () => {
    const query = setupTransactions();

    const created = await repository().createAutomation({
      ...validActiveInput,
      user_id: '00000000-0000-4000-8000-000000000001',
      account_id: '10000000-0000-4000-8000-000000000002',
      steps: [
        {
          step_type: 'condition',
          step_config: { subject: 'message', operand: 'contains' },
          branches: {
            yes: [
              {
                step_type: 'send_message',
                step_config: { text: 'Synthetic reply' },
              },
            ],
            no: [],
          },
        },
      ],
    });

    expect(created).toMatchObject({
      id: automationId,
      user_id: sessionA.userId,
      account_id: accountA,
      name: validActiveInput.name,
      description: validActiveInput.description,
      trigger_type: validActiveInput.trigger_type,
      trigger_config: validActiveInput.trigger_config,
      is_active: true,
      execution_count: 0,
      last_executed_at: null,
    });
    const parentInsert = query.mock.calls.find(([sql]) =>
      sql.includes('INSERT INTO public.automations')
    );
    expect(parentInsert?.[1]).toEqual([
      automationId,
      sessionA.userId,
      accountA,
      validActiveInput.name,
      validActiveInput.description,
      validActiveInput.trigger_type,
      JSON.stringify(validActiveInput.trigger_config),
      true,
    ]);
    const stepsInsert = query.mock.calls.find(([sql]) =>
      sql.includes('jsonb_to_recordset')
    );
    expect(JSON.parse(String(stepsInsert?.[1]?.[0]))).toEqual([
      {
        id: rootStepId,
        automation_id: automationId,
        parent_step_id: null,
        branch: null,
        step_type: 'condition',
        step_config: { subject: 'message', operand: 'contains' },
        position: 0,
      },
      {
        id: childStepId,
        automation_id: automationId,
        parent_step_id: rootStepId,
        branch: 'yes',
        step_type: 'send_message',
        step_config: { text: 'Synthetic reply' },
        position: 0,
      },
    ]);
    expect(
      query.mock.calls.findIndex(([sql]) =>
        sql.includes('INSERT INTO public.automations')
      )
    ).toBeLessThan(
      query.mock.calls.findIndex(([sql]) => sql.includes('jsonb_to_recordset'))
    );
  });

  it('maps legacy flat template seeds and defaults an omitted child branch to yes', async () => {
    const query = setupTransactions();
    const flatSteps = [
      {
        step_type: 'condition',
        step_config: { subject: 'message', operand: 'contains' },
      },
      {
        step_type: 'send_message',
        step_config: { text: 'Synthetic reply' },
        parent_index: 0,
      },
    ];

    await repository().createAutomation({
      ...validActiveInput,
      steps: flatSteps,
    });

    const stepsInsert = query.mock.calls.find(([sql]) =>
      sql.includes('jsonb_to_recordset')
    );
    expect(JSON.parse(String(stepsInsert?.[1]?.[0]))).toMatchObject([
      { id: rootStepId, parent_step_id: null, branch: null, position: 0 },
      {
        id: childStepId,
        parent_step_id: rootStepId,
        branch: 'yes',
        position: 0,
      },
    ]);
  });

  it('allows incomplete drafts, including an empty steps list', async () => {
    const query = setupTransactions();

    const created = await repository(idSequence(automationId)).createAutomation(
      {
        name: 'Synthetic draft',
        trigger_type: 'keyword_match',
        trigger_config: {},
        is_active: false,
        steps: [],
      }
    );

    expect(created.is_active).toBe(false);
    expect(
      query.mock.calls.some(([sql]) => sql.includes('jsonb_to_recordset'))
    ).toBe(false);
  });

  it('rejects invalid active configurations before inserting any row', async () => {
    const query = setupTransactions();

    await expect(
      repository().createAutomation({
        ...validActiveInput,
        trigger_config: { keywords: [], match_type: 'invalid' },
        steps: [{ step_type: 'send_message', step_config: {} }],
      })
    ).rejects.toEqual(new AppError('bad_request'));
    expect(
      query.mock.calls.some(([sql]) =>
        sql.includes('INSERT INTO public.automations')
      )
    ).toBe(false);
  });

  it('validates nested active steps at every condition depth', async () => {
    const query = setupTransactions();

    await expect(
      repository().createAutomation({
        ...validActiveInput,
        steps: [
          {
            step_type: 'condition',
            step_config: { subject: 'message', operand: 'contains' },
            branches: {
              yes: [
                {
                  step_type: 'condition',
                  step_config: { subject: 'message', operand: 'equals' },
                  branches: {
                    yes: [{ step_type: 'send_message', step_config: {} }],
                  },
                },
              ],
            },
          },
        ],
      })
    ).rejects.toEqual(new AppError('bad_request'));
    expect(
      query.mock.calls.some(([sql]) =>
        sql.includes('INSERT INTO public.automations')
      )
    ).toBe(false);
  });

  it('rolls back the parent when step insertion fails', async () => {
    const query = setupTransactions({ failStepInsert: true });

    await expect(
      repository().createAutomation({
        ...validActiveInput,
        is_active: false,
      })
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

  it('fails closed on a flat seed with an invalid condition parent', async () => {
    const query = setupTransactions();

    await expect(
      repository().createAutomation({
        ...validActiveInput,
        steps: [
          { step_type: 'send_message', step_config: { text: 'root' } },
          {
            step_type: 'send_message',
            step_config: { text: 'child' },
            parent_index: 0,
            branch: 'yes',
          },
        ],
      })
    ).rejects.toEqual(new AppError('bad_request'));
    expect(
      query.mock.calls.some(([sql]) =>
        sql.includes('INSERT INTO public.automations')
      )
    ).toBe(false);
  });

  it('rejects mixed flat and tree step payloads before parent insertion', async () => {
    const query = setupTransactions();

    await expect(
      repository().createAutomation({
        ...validActiveInput,
        is_active: false,
        steps: [
          {
            step_type: 'condition',
            step_config: {},
            branches: { yes: [] },
          },
          {
            step_type: 'send_message',
            step_config: { text: 'child' },
            parent_index: 0,
            branch: 'yes',
            branches: { no: [] },
          },
        ],
      })
    ).rejects.toEqual(new AppError('bad_request'));
    expect(
      query.mock.calls.some(([sql]) =>
        sql.includes('INSERT INTO public.automations')
      )
    ).toBe(false);
  });

  it('rejects duplicate generated UUIDs before inserting the parent', async () => {
    const query = setupTransactions();

    await expect(
      repository(
        idSequence(automationId, rootStepId, rootStepId)
      ).createAutomation({
        ...validActiveInput,
        is_active: false,
        steps: [
          { step_type: 'send_message', step_config: { text: 'first' } },
          { step_type: 'send_message', step_config: { text: 'second' } },
        ],
      })
    ).rejects.toEqual(new AppError('db_error'));
    expect(
      query.mock.calls.some(([sql]) =>
        sql.includes('INSERT INTO public.automations')
      )
    ).toBe(false);
  });
});
