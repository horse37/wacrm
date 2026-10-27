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
import { createPostgresAutomationEditorRepository } from './automation-editor';

const sessionA = { userId: '00000000-0000-4000-8000-000000000003' };
const accountA = '10000000-0000-4000-8000-000000000001';
const automationId = '30000000-0000-4000-8000-000000000001';
const conditionId = '40000000-0000-4000-8000-000000000001';
const sendId = '40000000-0000-4000-8000-000000000002';
const yesId = '40000000-0000-4000-8000-000000000003';
const noId = '40000000-0000-4000-8000-000000000004';
const yesSiblingId = '40000000-0000-4000-8000-000000000005';
const legacyYesId = '40000000-0000-4000-8000-000000000006';

const parentRows: Record<string, unknown>[] = [
  {
    id: automationId,
    name: 'Synthetic editor automation',
    description: 'Synthetic description',
    trigger_type: 'new_message_received',
    trigger_config: { keywords: ['synthetic'] },
    is_active: false,
    creator_user_id: sessionA.userId,
  },
];

const stepRows: Record<string, unknown>[] = [
  {
    id: noId,
    parent_step_id: conditionId,
    branch: 'no',
    step_type: 'send_message',
    step_config: { text: 'Synthetic no branch' },
    position: 0,
  },
  {
    id: sendId,
    parent_step_id: null,
    branch: null,
    step_type: 'send_message',
    step_config: { text: 'Synthetic root' },
    position: 1,
  },
  {
    id: yesSiblingId,
    parent_step_id: conditionId,
    branch: 'yes',
    step_type: 'wait',
    step_config: { amount: 1, unit: 'minutes' },
    position: 0,
  },
  {
    id: yesId,
    parent_step_id: conditionId,
    branch: 'yes',
    step_type: 'add_tag',
    step_config: { tag_id: 'synthetic-tag' },
    position: 0,
  },
  {
    id: legacyYesId,
    parent_step_id: conditionId,
    branch: null,
    step_type: 'send_message',
    step_config: { text: 'Legacy yes branch' },
    position: 1,
  },
  {
    id: conditionId,
    parent_step_id: null,
    branch: null,
    step_type: 'condition',
    step_config: { subject: 'message', operand: 'contains' },
    position: 0,
  },
];

function setupTransactions({
  role = 'viewer',
  parents = parentRows,
  steps = stepRows,
}: {
  role?: string;
  parents?: Record<string, unknown>[];
  steps?: Record<string, unknown>[];
} = {}) {
  const transactionQuery = vi.fn(
    async (...args: [sql: string, values?: readonly unknown[]]) => {
      const [sql] = args;
      if (sql.includes('set_config')) return { rows: [], rowCount: 1 };
      if (sql.includes('INNER JOIN public.accounts')) {
        return {
          rows: [
            {
              userId: sessionA.userId,
              accountId: accountA,
              role,
              accountName: 'Synthetic Account A',
            },
          ],
          rowCount: 1,
        };
      }
      if (sql.includes('FROM public.automations AS a')) {
        return { rows: parents, rowCount: parents.length };
      }
      if (sql.includes('FROM public.automation_steps AS s')) {
        return { rows: steps, rowCount: steps.length };
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

describe('PostgreSQL automation-editor repository', () => {
  beforeEach(() => {
    mocks.withTransaction.mockReset();
  });

  it('requires a verified account before reading editor data', async () => {
    const repository = createPostgresAutomationEditorRepository(
      async () => null
    );

    await expect(repository.getForAutomation(automationId)).rejects.toEqual(
      new AppError('unauthorized')
    );
    expect(mocks.withTransaction).not.toHaveBeenCalled();
  });

  it('loads editor fields and builds ordered branches for a viewer', async () => {
    setupTransactions();
    const repository = createPostgresAutomationEditorRepository(
      async () => sessionA
    );

    await expect(repository.getForAutomation(automationId)).resolves.toEqual({
      automation: {
        id: automationId,
        name: 'Synthetic editor automation',
        description: 'Synthetic description',
        trigger_type: 'new_message_received',
        trigger_config: { keywords: ['synthetic'] },
        is_active: false,
      },
      steps: [
        {
          id: conditionId,
          step_type: 'condition',
          step_config: { subject: 'message', operand: 'contains' },
          branches: {
            yes: [
              {
                id: yesId,
                step_type: 'add_tag',
                step_config: { tag_id: 'synthetic-tag' },
                branches: { yes: [], no: [] },
              },
              {
                id: yesSiblingId,
                step_type: 'wait',
                step_config: { amount: 1, unit: 'minutes' },
                branches: { yes: [], no: [] },
              },
              {
                id: legacyYesId,
                step_type: 'send_message',
                step_config: { text: 'Legacy yes branch' },
                branches: { yes: [], no: [] },
              },
            ],
            no: [
              {
                id: noId,
                step_type: 'send_message',
                step_config: { text: 'Synthetic no branch' },
                branches: { yes: [], no: [] },
              },
            ],
          },
        },
        {
          id: sendId,
          step_type: 'send_message',
          step_config: { text: 'Synthetic root' },
          branches: { yes: [], no: [] },
        },
      ],
    });
  });

  it('binds account and automation scope and selects only editor fields', async () => {
    const query = setupTransactions();
    const repository = createPostgresAutomationEditorRepository(
      async () => sessionA
    );

    await repository.getForAutomation(automationId);

    const parent = query.mock.calls.find(([sql]) =>
      sql.includes('FROM public.automations AS a')
    );
    expect(parent?.[0]).toContain('a.account_id = $1');
    expect(parent?.[0]).toContain('a.id = $2');
    expect(parent?.[0]).toContain('a.user_id = $3');
    expect(parent?.[0]).toContain('creator.user_id = a.user_id');
    expect(parent?.[0]).toContain('creator.account_id = a.account_id');
    expect(parent?.[0]).not.toContain('SELECT *');
    expect(parent?.[1]).toEqual([accountA, automationId, sessionA.userId]);

    const steps = query.mock.calls.find(([sql]) =>
      sql.includes('FROM public.automation_steps AS s')
    );
    expect(steps?.[0]).toContain('s.automation_id = $1');
    expect(steps?.[0]).toContain('a.account_id = $2');
    expect(steps?.[0]).toContain('creator.user_id = a.user_id');
    expect(steps?.[0]).toContain('ORDER BY s.position ASC, s.id ASC');
    expect(steps?.[0]).not.toContain('SELECT *');
    expect(steps?.[1]).toEqual([automationId, accountA]);
    expect(
      query.mock.calls.some(
        ([sql, values]) =>
          sql === "SELECT set_config('request.jwt.claim.sub', $1, true)" &&
          values?.[0] === sessionA.userId
      )
    ).toBe(true);
  });

  it('rejects invalid IDs before querying the automation', async () => {
    const query = setupTransactions();
    const repository = createPostgresAutomationEditorRepository(
      async () => sessionA
    );

    await expect(repository.getForAutomation('not-a-uuid')).rejects.toEqual(
      new AppError('bad_request')
    );
    expect(
      query.mock.calls.some(([sql]) =>
        sql.includes('FROM public.automations AS a')
      )
    ).toBe(false);
  });

  it('returns not found without querying steps outside the verified account', async () => {
    const query = setupTransactions({ parents: [] });
    const repository = createPostgresAutomationEditorRepository(
      async () => sessionA
    );

    await expect(repository.getForAutomation(automationId)).rejects.toEqual(
      new AppError('not_found')
    );
    expect(
      query.mock.calls.some(([sql]) =>
        sql.includes('FROM public.automation_steps AS s')
      )
    ).toBe(false);
  });

  it('returns an empty step tree for an automation without steps', async () => {
    setupTransactions({ steps: [] });
    const repository = createPostgresAutomationEditorRepository(
      async () => sessionA
    );

    await expect(
      repository.getForAutomation(automationId)
    ).resolves.toMatchObject({
      automation: { id: automationId },
      steps: [],
    });
  });

  it.each([
    {
      label: 'missing step parent',
      change: (rows: Record<string, unknown>[]) => {
        rows[0].parent_step_id = '40000000-0000-4000-8000-000000000099';
      },
    },
    {
      label: 'non-condition parent',
      change: (rows: Record<string, unknown>[]) => {
        rows.find((row) => row.id === yesId)!.parent_step_id = sendId;
      },
    },
    {
      label: 'cyclic steps',
      change: (rows: Record<string, unknown>[]) => {
        rows.find((row) => row.id === conditionId)!.parent_step_id = yesId;
        rows.find((row) => row.id === conditionId)!.branch = 'yes';
      },
    },
    {
      label: 'invalid branch',
      change: (rows: Record<string, unknown>[]) => {
        rows.find((row) => row.id === yesId)!.branch = 'maybe';
      },
    },
  ])('fails closed for $label', async ({ change }) => {
    const rows = stepRows.map((row) => ({ ...row }));
    change(rows);
    setupTransactions({ steps: rows });
    const repository = createPostgresAutomationEditorRepository(
      async () => sessionA
    );

    await expect(repository.getForAutomation(automationId)).rejects.toEqual(
      new AppError('db_error')
    );
  });

  it('fails closed on malformed config or position values', async () => {
    const invalidConfig = stepRows.map((row) => ({ ...row }));
    invalidConfig[0].step_config = [];
    setupTransactions({ steps: invalidConfig });
    const repository = createPostgresAutomationEditorRepository(
      async () => sessionA
    );
    await expect(repository.getForAutomation(automationId)).rejects.toEqual(
      new AppError('db_error')
    );

    const invalidPosition = stepRows.map((row) => ({ ...row }));
    invalidPosition[0].position = -1;
    setupTransactions({ steps: invalidPosition });
    await expect(repository.getForAutomation(automationId)).rejects.toEqual(
      new AppError('db_error')
    );
  });

  it('hides driver errors behind a safe database error', async () => {
    const query = setupTransactions();
    query.mockImplementation(async (sql) => {
      if (sql.includes('set_config')) return { rows: [], rowCount: 1 };
      if (sql.includes('INNER JOIN public.accounts')) {
        return {
          rows: [
            {
              userId: sessionA.userId,
              accountId: accountA,
              role: 'viewer',
              accountName: 'Synthetic Account A',
            },
          ],
          rowCount: 1,
        };
      }
      throw new Error('synthetic driver detail must not escape');
    });
    const repository = createPostgresAutomationEditorRepository(
      async () => sessionA
    );

    await expect(repository.getForAutomation(automationId)).rejects.toEqual(
      new AppError('db_error')
    );
  });
});
