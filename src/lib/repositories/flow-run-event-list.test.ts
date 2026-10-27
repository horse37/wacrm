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
import { createPostgresFlowRunEventListRepository } from './flow-run-event-list';

const sessionA = { userId: '00000000-0000-4000-8000-000000000003' };
const accountA = '10000000-0000-4000-8000-000000000001';
const flowId = '30000000-0000-4000-8000-000000000001';
const flowCreatorId = '00000000-0000-4000-8000-000000000001';

const flowRows: Record<string, unknown>[] = [
  {
    id: flowId,
    name: 'Synthetic flow',
    creator_user_id: flowCreatorId,
    account_id: accountA,
  },
];

const eventRows: Record<string, unknown>[] = [
  {
    event_id: '60000000-0000-4000-8000-000000000001',
    flow_run_id: '50000000-0000-4000-8000-000000000054',
    flow_id: flowId,
    account_id: accountA,
    user_id: flowCreatorId,
    event_type: 'node_entered',
    node_key: 'start',
    payload: { node_type: 'start' },
    created_at: '2026-10-19T12:00:00.000Z',
  },
  {
    event_id: '60000000-0000-4000-8000-000000000002',
    flow_run_id: '50000000-0000-4000-8000-000000000055',
    flow_id: flowId,
    account_id: accountA,
    user_id: flowCreatorId,
    event_type: 'started',
    node_key: 'start',
    payload: { source: 'synthetic' },
    created_at: '2026-10-20T12:00:00.000Z',
  },
  {
    event_id: '60000000-0000-4000-8000-000000000003',
    flow_run_id: '50000000-0000-4000-8000-000000000055',
    flow_id: flowId,
    account_id: accountA,
    user_id: flowCreatorId,
    event_type: 'reply_received',
    node_key: null,
    payload: { reply_id: 'synthetic-yes' },
    created_at: '2026-10-20T12:00:00.000Z',
  },
  {
    event_id: '60000000-0000-4000-8000-000000000004',
    flow_run_id: '50000000-0000-4000-8000-000000000006',
    flow_id: flowId,
    account_id: accountA,
    user_id: flowCreatorId,
    event_type: 'completed',
    node_key: 'end',
    payload: {},
    created_at: '2026-10-22T12:00:00.000Z',
  },
];

function setupTransactions({
  role = 'viewer',
  flows = flowRows,
  events = eventRows,
}: {
  role?: string;
  flows?: Record<string, unknown>[];
  events?: Record<string, unknown>[];
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
      if (sql.includes('WITH recent_runs AS')) {
        return { rows: events, rowCount: events.length };
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

describe('PostgreSQL flow-run-event-list repository', () => {
  beforeEach(() => {
    mocks.withTransaction.mockReset();
  });

  it('requires verified account membership before reading a flow', async () => {
    const repository = createPostgresFlowRunEventListRepository(
      async () => null
    );

    await expect(repository.listForFlow(flowId)).rejects.toEqual(
      new AppError('unauthorized')
    );
    expect(mocks.withTransaction).not.toHaveBeenCalled();
  });

  it('rejects invalid UUID before opening the event-list transaction', async () => {
    const query = setupTransactions();
    const repository = createPostgresFlowRunEventListRepository(
      async () => sessionA
    );

    await expect(repository.listForFlow('bad-id')).rejects.toEqual(
      new AppError('bad_request')
    );
    expect(
      query.mock.calls.some(([sql]) => sql.includes('WITH recent_runs AS'))
    ).toBe(false);
  });

  it('returns minimal validated events in chronological order', async () => {
    setupTransactions();
    const repository = createPostgresFlowRunEventListRepository(
      async () => sessionA
    );

    await expect(repository.listForFlow(flowId)).resolves.toEqual([
      {
        flow_run_id: '50000000-0000-4000-8000-000000000054',
        event_type: 'node_entered',
        node_key: 'start',
        payload: { node_type: 'start' },
        created_at: '2026-10-19T12:00:00.000Z',
      },
      {
        flow_run_id: '50000000-0000-4000-8000-000000000055',
        event_type: 'started',
        node_key: 'start',
        payload: { source: 'synthetic' },
        created_at: '2026-10-20T12:00:00.000Z',
      },
      {
        flow_run_id: '50000000-0000-4000-8000-000000000055',
        event_type: 'reply_received',
        node_key: null,
        payload: { reply_id: 'synthetic-yes' },
        created_at: '2026-10-20T12:00:00.000Z',
      },
      {
        flow_run_id: '50000000-0000-4000-8000-000000000006',
        event_type: 'completed',
        node_key: 'end',
        payload: {},
        created_at: '2026-10-22T12:00:00.000Z',
      },
    ]);
  });

  it('scopes the parent and recent run CTE to account, flow, and creators', async () => {
    const query = setupTransactions();
    const repository = createPostgresFlowRunEventListRepository(
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

    const events = query.mock.calls.find(([sql]) =>
      sql.includes('WITH recent_runs AS')
    );
    expect(events?.[0]).toContain('r.flow_id = $1');
    expect(events?.[0]).toContain('r.account_id = $2');
    expect(events?.[0]).toContain('f.user_id = r.user_id');
    expect(events?.[0]).not.toContain('public.profiles AS run_creator');
    expect(events?.[0]).toContain('ORDER BY r.started_at DESC, r.id DESC');
    expect(events?.[0]).toContain('LIMIT 50');
    expect(events?.[0]).toContain('ORDER BY e.created_at ASC, e.id ASC');
    expect(events?.[0]).not.toContain('SELECT *');
    expect(events?.[1]).toEqual([flowId, accountA]);
    expect(
      query.mock.calls.some(
        ([sql, values]) =>
          sql === "SELECT set_config('request.jwt.claim.sub', $1, true)" &&
          values?.[0] === sessionA.userId
      )
    ).toBe(true);
  });

  it('does not query events when the flow is not visible in the account', async () => {
    const query = setupTransactions({ flows: [] });
    const repository = createPostgresFlowRunEventListRepository(
      async () => sessionA
    );

    await expect(repository.listForFlow(flowId)).rejects.toEqual(
      new AppError('not_found')
    );
    expect(
      query.mock.calls.some(([sql]) => sql.includes('WITH recent_runs AS'))
    ).toBe(false);
  });

  it('returns an empty event list for a visible flow without recent run events', async () => {
    setupTransactions({ events: [] });
    const repository = createPostgresFlowRunEventListRepository(
      async () => sessionA
    );

    await expect(repository.listForFlow(flowId)).resolves.toEqual([]);
  });

  it.each([
    ['invalid event ID', { event_id: 'not-a-uuid' }],
    ['invalid run ID', { flow_run_id: 'not-a-uuid' }],
    ['wrong flow', { flow_id: '30000000-0000-4000-8000-000000000009' }],
    ['wrong account', { account_id: '10000000-0000-4000-8000-000000000009' }],
    ['wrong run author', { user_id: '00000000-0000-4000-8000-000000000009' }],
    ['unsupported event type', { event_type: 'queued' }],
    ['non-string node key', { node_key: 3 }],
    ['array payload', { payload: [] }],
    ['invalid timestamp', { created_at: 'not-a-date' }],
  ])('fails closed for %s', async (_label, invalidFields) => {
    const events = eventRows.map((row) => ({ ...row }));
    events[0] = { ...events[0], ...invalidFields };
    setupTransactions({ events });
    const repository = createPostgresFlowRunEventListRepository(
      async () => sessionA
    );

    await expect(repository.listForFlow(flowId)).rejects.toEqual(
      new AppError('db_error')
    );
  });
});
