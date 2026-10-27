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
import { createPostgresAutomationUpdatePersistenceRepository } from './automation-update-persistence';

const sessionA = { userId: '00000000-0000-4000-8000-000000000003' };
const accountA = '10000000-0000-4000-8000-000000000001';
const automationA = '30000000-0000-4000-8000-000000000001';
const stepA = '40000000-0000-4000-8000-000000000001';
const membershipA = {
  userId: sessionA.userId,
  accountId: accountA,
  role: 'agent',
  accountName: 'Synthetic Account A',
};
const activeAutomation = {
  id: automationA,
  user_id: sessionA.userId,
  account_id: accountA,
  name: 'Synthetic active automation',
  description: 'Synthetic description',
  trigger_type: 'keyword_match',
  trigger_config: { keywords: ['hello'], match_type: 'contains' },
  is_active: true,
};
const validStep = {
  id: stepA,
  parent_step_id: null,
  branch: null,
  step_type: 'send_message',
  step_config: { text: 'Synthetic reply' },
  position: 0,
};

function setupTransactions({
  role = 'agent',
  automations = [activeAutomation],
  steps = [validStep],
  failStepInsert = false,
}: {
  role?: string;
  automations?: Record<string, unknown>[];
  steps?: Record<string, unknown>[];
  failStepInsert?: boolean;
} = {}) {
  const transactionQuery = vi.fn(
    async (...args: [sql: string, values?: readonly unknown[]]) => {
      const [sql, values] = args;
      if (sql.includes('set_config')) return { rows: [], rowCount: 1 };
      if (sql.includes('INNER JOIN public.accounts')) {
        return { rows: [{ ...membershipA, role }], rowCount: 1 };
      }
      if (sql.includes('FROM public.automations AS automation')) {
        return { rows: automations, rowCount: automations.length };
      }
      if (sql.includes('FROM public.automation_steps AS step')) {
        return { rows: steps, rowCount: steps.length };
      }
      if (sql.includes('UPDATE public.automations AS automation')) {
        return { rows: [{ id: automationA }], rowCount: 1 };
      }
      if (sql.includes('DELETE FROM public.automation_steps AS step')) {
        return { rows: [], rowCount: steps.length };
      }
      if (sql.includes('INSERT INTO public.automation_steps')) {
        if (failStepInsert) throw new Error('synthetic insert failure');
        const inserted = JSON.parse(String(values?.[0])) as { id: string }[];
        return {
          rows: inserted.map(({ id }) => ({ id })),
          rowCount: inserted.length,
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

describe('PostgreSQL automation-update persistence repository', () => {
  beforeEach(() => {
    mocks.withTransaction.mockReset();
  });

  it('requires a verified session before opening an update transaction', async () => {
    const repository = createPostgresAutomationUpdatePersistenceRepository(
      async () => null
    );

    await expect(
      repository.patchOwnedAutomation(automationA, { name: 'Changed' })
    ).rejects.toEqual(new AppError('unauthorized'));
    expect(mocks.withTransaction).not.toHaveBeenCalled();
  });

  it('denies viewers before loading or updating automation data', async () => {
    const query = setupTransactions({ role: 'viewer' });
    const repository = createPostgresAutomationUpdatePersistenceRepository(
      async () => sessionA
    );

    await expect(
      repository.patchOwnedAutomation(automationA, { name: 'Changed' })
    ).rejects.toEqual(new AppError('forbidden'));
    expect(
      query.mock.calls.some(([sql]) =>
        sql.includes('FROM public.automations AS automation')
      )
    ).toBe(false);
  });

  it('validates the automation UUID before issuing update SQL', async () => {
    const query = setupTransactions();
    const repository = createPostgresAutomationUpdatePersistenceRepository(
      async () => sessionA
    );

    await expect(
      repository.patchOwnedAutomation('invalid-id', { name: 'Changed' })
    ).rejects.toEqual(new AppError('bad_request'));
    expect(
      query.mock.calls.some(([sql]) =>
        sql.includes('FROM public.automations AS automation')
      )
    ).toBe(false);
  });

  it('updates only allowlisted provided fields scoped to the verified account', async () => {
    const query = setupTransactions();
    const repository = createPostgresAutomationUpdatePersistenceRepository(
      async () => sessionA
    );

    await expect(
      repository.patchOwnedAutomation(automationA, {
        name: 'Changed name',
        ignored: 'not persisted',
      })
    ).resolves.toBeUndefined();

    const update = query.mock.calls.find(([sql]) =>
      sql.includes('UPDATE public.automations AS automation')
    );
    expect(update?.[0]).toContain('automation.id = $');
    expect(update?.[0]).toContain('automation.user_id = $');
    expect(update?.[0]).toContain('automation.account_id = $');
    expect(update?.[1]).toContain('Changed name');
    expect(update?.[1]).not.toContain('not persisted');
    expect(
      query.mock.calls.some(([sql]) =>
        sql.includes('DELETE FROM public.automation_steps')
      )
    ).toBe(false);
  });

  it('validates effective active configuration when only header fields are patched', async () => {
    const query = setupTransactions({
      steps: [{ ...validStep, step_config: {} }],
    });
    const repository = createPostgresAutomationUpdatePersistenceRepository(
      async () => sessionA
    );

    await expect(
      repository.patchOwnedAutomation(automationA, { description: 'Changed' })
    ).rejects.toMatchObject({
      code: 'bad_request',
      issues: expect.arrayContaining([
        expect.objectContaining({ path: 'steps[0].text' }),
      ]),
    });
    expect(
      query.mock.calls.some(
        ([sql]) =>
          sql.includes('UPDATE public.automations AS automation') ||
          sql.includes('DELETE FROM public.automation_steps')
      )
    ).toBe(false);
  });

  it.each([
    {
      label: 'a self-reference',
      storedSteps: [
        {
          ...validStep,
          parent_step_id: stepA,
          branch: 'yes',
          step_type: 'condition',
          step_config: { subject: 'message', operand: 'contains' },
        },
      ],
    },
    {
      label: 'a two-step cycle',
      storedSteps: [
        {
          ...validStep,
          parent_step_id: '40000000-0000-4000-8000-000000000002',
          branch: 'yes',
          step_type: 'condition',
          step_config: { subject: 'message', operand: 'contains' },
        },
        {
          ...validStep,
          id: '40000000-0000-4000-8000-000000000002',
          parent_step_id: stepA,
          branch: 'no',
          step_type: 'condition',
          step_config: { subject: 'message', operand: 'contains' },
        },
      ],
    },
  ])(
    'fails closed when stored steps contain $label',
    async ({ storedSteps }) => {
      const query = setupTransactions({ steps: storedSteps });
      const repository = createPostgresAutomationUpdatePersistenceRepository(
        async () => sessionA
      );

      await expect(
        repository.patchOwnedAutomation(automationA, { description: 'Changed' })
      ).rejects.toEqual(new AppError('db_error'));
      expect(
        query.mock.calls.some(
          ([sql]) =>
            sql.includes('UPDATE public.automations AS automation') ||
            sql.includes('DELETE FROM public.automation_steps AS step')
        )
      ).toBe(false);
    }
  );

  it('rejects an invalid active step replacement before issuing write SQL', async () => {
    const query = setupTransactions();
    const repository = createPostgresAutomationUpdatePersistenceRepository(
      async () => sessionA
    );

    await expect(
      repository.patchOwnedAutomation(automationA, {
        name: 'Must not persist',
        steps: [{ step_type: 'send_message', step_config: {} }],
      })
    ).rejects.toMatchObject({
      code: 'bad_request',
      issues: expect.arrayContaining([
        expect.objectContaining({ path: 'steps[0].text' }),
      ]),
    });
    expect(
      query.mock.calls.some(
        ([sql]) =>
          sql.includes('UPDATE public.automations') ||
          sql.includes('DELETE FROM public.automation_steps')
      )
    ).toBe(false);
  });

  it('replaces provided steps atomically without updating omitted header fields', async () => {
    const query = setupTransactions();
    const repository = createPostgresAutomationUpdatePersistenceRepository(
      async () => sessionA,
      (() => {
        const ids = [
          '50000000-0000-4000-8000-000000000001',
          '50000000-0000-4000-8000-000000000002',
        ];
        return () => ids.shift() ?? '';
      })()
    );

    await expect(
      repository.patchOwnedAutomation(automationA, {
        is_active: false,
        steps: [
          {
            step_type: 'condition',
            step_config: { subject: 'message', operand: 'contains' },
            branches: {
              yes: [
                {
                  step_type: 'send_message',
                  step_config: { text: 'New reply' },
                },
              ],
            },
          },
        ],
      })
    ).resolves.toBeUndefined();

    const deletion = query.mock.calls.find(([sql]) =>
      sql.includes('DELETE FROM public.automation_steps AS step')
    );
    expect(deletion?.[1]).toContain(automationA);
    const insertion = query.mock.calls.find(([sql]) =>
      sql.includes('INSERT INTO public.automation_steps')
    );
    expect(insertion?.[1]).toBeDefined();
    const rows = JSON.parse(String(insertion?.[1]?.[0]));
    expect(rows).toEqual([
      {
        id: '50000000-0000-4000-8000-000000000001',
        automation_id: automationA,
        parent_step_id: null,
        branch: null,
        step_type: 'condition',
        step_config: { subject: 'message', operand: 'contains' },
        position: 0,
      },
      {
        id: '50000000-0000-4000-8000-000000000002',
        automation_id: automationA,
        parent_step_id: '50000000-0000-4000-8000-000000000001',
        branch: 'yes',
        step_type: 'send_message',
        step_config: { text: 'New reply' },
        position: 0,
      },
    ]);
  });

  it('returns not found without writes for missing or non-owned automations', async () => {
    const query = setupTransactions({ automations: [] });
    const repository = createPostgresAutomationUpdatePersistenceRepository(
      async () => sessionA
    );

    await expect(
      repository.patchOwnedAutomation(automationA, { name: 'Changed' })
    ).rejects.toEqual(new AppError('not_found'));
    expect(
      query.mock.calls.some(
        ([sql]) =>
          sql.includes('UPDATE public.automations') ||
          sql.includes('DELETE FROM public.automation_steps')
      )
    ).toBe(false);
  });
});
