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
import { createPostgresFlowRunListRepository } from './flow-run-list';

const sessionA = { userId: '00000000-0000-4000-8000-000000000003' };
const accountA = '10000000-0000-4000-8000-000000000001';
const flowId = '30000000-0000-4000-8000-000000000001';
const flowCreatorId = '00000000-0000-4000-8000-000000000001';
const contactId = '40000000-0000-4000-8000-000000000001';
const flowRows: Record<string, unknown>[] = [
  {
    id: flowId,
    name: 'Synthetic flow',
    creator_user_id: flowCreatorId,
    account_id: accountA,
  },
];

const runRows: Record<string, unknown>[] = [
  {
    id: '50000000-0000-4000-8000-000000000002',
    flow_id: flowId,
    account_id: accountA,
    user_id: flowCreatorId,
    status: 'active',
    current_node_key: 'collect',
    started_at: '2026-10-20T12:00:00.000Z',
    last_advanced_at: '2026-10-20T12:01:00.000Z',
    ended_at: null,
    end_reason: null,
    vars: { synthetic_field: 'Synthetic value' },
    reprompt_count: 2,
    contact_id: contactId,
    contact_name: 'Synthetic contact',
    contact_phone: '+15555550100',
  },
  {
    id: '50000000-0000-4000-8000-000000000001',
    flow_id: flowId,
    account_id: accountA,
    user_id: flowCreatorId,
    status: 'completed',
    current_node_key: null,
    started_at: '2026-10-19T12:00:00.000Z',
    last_advanced_at: '2026-10-19T12:05:00.000Z',
    ended_at: '2026-10-19T12:05:00.000Z',
    end_reason: 'end_node',
    vars: {},
    reprompt_count: 0,
    contact_id: null,
    contact_name: null,
    contact_phone: null,
  },
];

function setupTransactions({
  role = 'viewer',
  flows = flowRows,
  runs = runRows,
}: {
  role?: string;
  flows?: Record<string, unknown>[];
  runs?: Record<string, unknown>[];
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
      if (sql.includes('FROM public.flows AS f')) {
        return { rows: flows, rowCount: flows.length };
      }
      if (sql.includes('FROM public.flow_runs AS r')) {
        return { rows: runs, rowCount: runs.length };
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

describe('PostgreSQL flow-run-list repository', () => {
  beforeEach(() => {
    mocks.withTransaction.mockReset();
  });

  it('requires a verified account membership before querying a flow', async () => {
    const repository = createPostgresFlowRunListRepository(async () => null);

    await expect(repository.listForFlow(flowId)).rejects.toEqual(
      new AppError('unauthorized')
    );
    expect(mocks.withTransaction).not.toHaveBeenCalled();
  });

  it('rejects an invalid flow UUID before opening the run-list transaction', async () => {
    const query = setupTransactions();
    const repository = createPostgresFlowRunListRepository(
      async () => sessionA
    );

    await expect(repository.listForFlow('not-a-uuid')).rejects.toEqual(
      new AppError('bad_request')
    );
    expect(
      query.mock.calls.some(([sql]) => sql.includes('FROM public.flows AS f'))
    ).toBe(false);
  });

  it('returns the minimal flow and newest-first run DTOs with optional contact', async () => {
    setupTransactions();
    const repository = createPostgresFlowRunListRepository(
      async () => sessionA
    );

    await expect(repository.listForFlow(flowId)).resolves.toEqual({
      flow: { id: flowId, name: 'Synthetic flow' },
      runs: [
        {
          id: '50000000-0000-4000-8000-000000000002',
          status: 'active',
          current_node_key: 'collect',
          started_at: '2026-10-20T12:00:00.000Z',
          last_advanced_at: '2026-10-20T12:01:00.000Z',
          ended_at: null,
          end_reason: null,
          vars: { synthetic_field: 'Synthetic value' },
          reprompt_count: 2,
          contact: {
            id: contactId,
            name: 'Synthetic contact',
            phone: '+15555550100',
          },
        },
        {
          id: '50000000-0000-4000-8000-000000000001',
          status: 'completed',
          current_node_key: null,
          started_at: '2026-10-19T12:00:00.000Z',
          last_advanced_at: '2026-10-19T12:05:00.000Z',
          ended_at: '2026-10-19T12:05:00.000Z',
          end_reason: 'end_node',
          vars: {},
          reprompt_count: 0,
          contact: null,
        },
      ],
    });
  });

  it('uses explicit account, flow, author, contact, ordering, and limit predicates', async () => {
    const query = setupTransactions();
    const repository = createPostgresFlowRunListRepository(
      async () => sessionA
    );

    await repository.listForFlow(flowId);

    const parent = query.mock.calls.find(([sql]) =>
      sql.includes('FROM public.flows AS f')
    );
    expect(parent?.[0]).toContain('f.id = $1');
    expect(parent?.[0]).toContain('f.account_id = $2');
    expect(parent?.[0]).toContain('WHERE f.id = $1');
    expect(parent?.[0]).not.toContain('public.profiles AS creator');
    expect(parent?.[1]).toEqual([flowId, accountA]);

    const runs = query.mock.calls.find(([sql]) =>
      sql.includes('FROM public.flow_runs AS r')
    );
    expect(runs?.[0]).toContain('r.flow_id = $1');
    expect(runs?.[0]).toContain('r.account_id = $2');
    expect(runs?.[0]).toContain('f.user_id = r.user_id');
    expect(runs?.[0]).not.toContain('public.profiles AS run_creator');
    expect(runs?.[0]).toContain('c.account_id = r.account_id');
    expect(runs?.[0]).toContain('ORDER BY r.started_at DESC, r.id DESC');
    expect(runs?.[0]).toContain('LIMIT 50');
    expect(runs?.[0]).not.toContain('SELECT *');
    expect(runs?.[1]).toEqual([flowId, accountA]);
    expect(
      query.mock.calls.some(
        ([sql, values]) =>
          sql === "SELECT set_config('request.jwt.claim.sub', $1, true)" &&
          values?.[0] === sessionA.userId
      )
    ).toBe(true);
  });

  it('returns not found when the flow is absent from the verified account', async () => {
    setupTransactions({ flows: [] });
    const repository = createPostgresFlowRunListRepository(
      async () => sessionA
    );

    await expect(repository.listForFlow(flowId)).rejects.toEqual(
      new AppError('not_found')
    );
  });

  it('returns an empty run list for a visible flow with no runs', async () => {
    setupTransactions({ runs: [] });
    const repository = createPostgresFlowRunListRepository(
      async () => sessionA
    );

    await expect(repository.listForFlow(flowId)).resolves.toEqual({
      flow: { id: flowId, name: 'Synthetic flow' },
      runs: [],
    });
  });

  it.each([
    ['invalid run UUID', { id: 'bad-id' }],
    ['wrong run flow', { flow_id: '30000000-0000-4000-8000-000000000009' }],
    ['wrong account', { account_id: '10000000-0000-4000-8000-000000000009' }],
    ['wrong author', { user_id: '00000000-0000-4000-8000-000000000009' }],
    ['invalid status', { status: 'queued' }],
    ['array vars', { vars: [] }],
    ['negative reprompt count', { reprompt_count: -1 }],
    ['fractional reprompt count', { reprompt_count: 1.5 }],
    ['invalid timestamp', { started_at: 'not-a-date' }],
    ['partial contact', { contact_phone: null }],
  ])('fails closed for %s', async (_label, invalidFields) => {
    const runs = runRows.map((row) => ({ ...row }));
    runs[0] = { ...runs[0], ...invalidFields };
    setupTransactions({ runs });
    const repository = createPostgresFlowRunListRepository(
      async () => sessionA
    );

    await expect(repository.listForFlow(flowId)).rejects.toEqual(
      new AppError('db_error')
    );
  });

  it('fails closed if a mocked driver exceeds the fixed run limit', async () => {
    const tooManyRuns = Array.from({ length: 51 }, (_, index) => ({
      ...runRows[0],
      id: `50000000-0000-4000-8000-${String(index + 100).padStart(12, '0')}`,
    }));
    setupTransactions({ runs: tooManyRuns });
    const repository = createPostgresFlowRunListRepository(
      async () => sessionA
    );

    await expect(repository.listForFlow(flowId)).rejects.toEqual(
      new AppError('db_error')
    );
  });
});
