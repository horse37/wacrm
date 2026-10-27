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
import { createPostgresAutomationLogsRepository } from './automation-logs';

const sessionA = { userId: '00000000-0000-4000-8000-000000000003' };
const accountA = '10000000-0000-4000-8000-000000000001';
const automationId = '30000000-0000-4000-8000-000000000001';
const membershipA = {
  userId: sessionA.userId,
  accountId: accountA,
  role: 'viewer',
  accountName: 'Synthetic Account A',
};
const automationRows = [
  {
    id: automationId,
    name: 'Synthetic automation',
    author_user_id: '00000000-0000-4000-8000-000000000001',
  },
];
const logRows = [
  {
    id: '40000000-0000-4000-8000-000000000001',
    trigger_event: 'new_message_received',
    steps_executed: [
      {
        step_id: '50000000-0000-4000-8000-000000000001',
        step_type: 'send_message',
        status: 'success',
        detail: 'Synthetic send result',
      },
    ],
    status: 'partial',
    error_message: null,
    created_at: '2026-10-19T10:00:00.000Z',
    contact_id: '60000000-0000-4000-8000-000000000001',
    contact_name: 'Synthetic Contact',
    contact_phone: '+15555550123',
  },
  {
    id: '40000000-0000-4000-8000-000000000002',
    trigger_event: 'keyword_match',
    steps_executed: [],
    status: 'failed',
    error_message: 'Synthetic failure',
    created_at: '2026-10-18T10:00:00.000Z',
    contact_id: null,
    contact_name: null,
    contact_phone: null,
  },
];

function setupTransactions({
  role = 'viewer',
  parents = automationRows,
  logs = logRows,
}: {
  role?: string;
  parents?: Record<string, unknown>[];
  logs?: Record<string, unknown>[];
} = {}) {
  const transactionQuery = vi.fn(
    async (...args: [sql: string, values?: readonly unknown[]]) => {
      const [sql] = args;
      if (sql.includes('set_config')) return { rows: [], rowCount: 1 };
      if (sql.includes('INNER JOIN public.accounts')) {
        return { rows: [{ ...membershipA, role }], rowCount: 1 };
      }
      if (sql.includes('FROM public.automations AS a')) {
        return { rows: parents, rowCount: parents.length };
      }
      if (sql.includes('FROM public.automation_logs AS l')) {
        return { rows: logs, rowCount: logs.length };
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

describe('PostgreSQL automation-logs repository', () => {
  beforeEach(() => {
    mocks.withTransaction.mockReset();
  });

  it('requires verified account membership before reading automation logs', async () => {
    const repository = createPostgresAutomationLogsRepository(async () => null);

    await expect(repository.listForAutomation(automationId)).rejects.toEqual(
      new AppError('unauthorized')
    );
    expect(mocks.withTransaction).not.toHaveBeenCalled();
  });

  it('allows a viewer to read sanitized parent and log fields', async () => {
    setupTransactions({ role: 'viewer' });
    const repository = createPostgresAutomationLogsRepository(
      async () => sessionA
    );

    await expect(repository.listForAutomation(automationId)).resolves.toEqual({
      automation: { id: automationId, name: 'Synthetic automation' },
      logs: [
        {
          id: '40000000-0000-4000-8000-000000000001',
          trigger_event: 'new_message_received',
          steps_executed: [
            {
              step_type: 'send_message',
              status: 'success',
              detail: 'Synthetic send result',
            },
          ],
          status: 'partial',
          error_message: null,
          created_at: '2026-10-19T10:00:00.000Z',
          contact: { name: 'Synthetic Contact', phone: '+15555550123' },
        },
        {
          id: '40000000-0000-4000-8000-000000000002',
          trigger_event: 'keyword_match',
          steps_executed: [],
          status: 'failed',
          error_message: 'Synthetic failure',
          created_at: '2026-10-18T10:00:00.000Z',
          contact: null,
        },
      ],
    });
  });

  it('rejects invalid automation IDs before issuing parent or log queries', async () => {
    const query = setupTransactions();
    const repository = createPostgresAutomationLogsRepository(
      async () => sessionA
    );

    await expect(repository.listForAutomation('invalid')).rejects.toEqual(
      new AppError('bad_request')
    );
    expect(
      query.mock.calls.some(([sql]) =>
        sql.includes('FROM public.automations AS a')
      )
    ).toBe(false);
  });

  it('uses verified account, automation, creator, contact, stable-order and limit predicates', async () => {
    const query = setupTransactions();
    const repository = createPostgresAutomationLogsRepository(
      async () => sessionA
    );

    await repository.listForAutomation(automationId);

    const parent = query.mock.calls.find(([sql]) =>
      sql.includes('FROM public.automations AS a')
    );
    expect(parent?.[0]).toContain('a.account_id = $1');
    expect(parent?.[0]).toContain('a.id = $2');
    expect(parent?.[0]).toContain('WHERE a.account_id = $1');
    expect(parent?.[0]).not.toContain('public.profiles AS creator');
    expect(parent?.[1]).toEqual([accountA, automationId]);

    const logs = query.mock.calls.find(([sql]) =>
      sql.includes('FROM public.automation_logs AS l')
    );
    expect(logs?.[0]).toContain('l.account_id = $1');
    expect(logs?.[0]).toContain('l.automation_id = $2');
    expect(logs?.[0]).toContain('l.user_id = $3');
    expect(logs?.[0]).toContain('c.account_id = l.account_id');
    expect(logs?.[0]).toContain('ORDER BY l.created_at DESC, l.id DESC');
    expect(logs?.[0]).toContain('LIMIT $4');
    expect(logs?.[1]).toEqual([
      accountA,
      automationId,
      automationRows[0].author_user_id,
      100,
    ]);
    expect(
      query.mock.calls.some(
        ([sql, values]) =>
          sql === "SELECT set_config('request.jwt.claim.sub', $1, true)" &&
          values?.[0] === sessionA.userId
      )
    ).toBe(true);
  });

  it('returns not found when automation is outside the verified account', async () => {
    const query = setupTransactions({ parents: [] });
    const repository = createPostgresAutomationLogsRepository(
      async () => sessionA
    );

    await expect(repository.listForAutomation(automationId)).rejects.toEqual(
      new AppError('not_found')
    );
    expect(
      query.mock.calls.some(([sql]) =>
        sql.includes('FROM public.automation_logs AS l')
      )
    ).toBe(false);
  });

  it('returns an empty log list for an automation with no executions', async () => {
    setupTransactions({ logs: [] });
    const repository = createPostgresAutomationLogsRepository(
      async () => sessionA
    );

    await expect(repository.listForAutomation(automationId)).resolves.toEqual({
      automation: { id: automationId, name: 'Synthetic automation' },
      logs: [],
    });
  });

  it('fails closed on malformed status, steps, and timestamp values', async () => {
    const malformedStatus = logRows.map((row) => ({ ...row }));
    malformedStatus[0].status = 'unknown';
    setupTransactions({ logs: malformedStatus });
    const repository = createPostgresAutomationLogsRepository(
      async () => sessionA
    );
    await expect(repository.listForAutomation(automationId)).rejects.toEqual(
      new AppError('db_error')
    );

    const malformedSteps = logRows.map((row) => ({ ...row }));
    malformedSteps[0].steps_executed = [
      {
        step_id: '50000000-0000-4000-8000-000000000001',
        step_type: 'send_message',
        status: 'unknown',
        detail: 'Synthetic send result',
      },
    ];
    setupTransactions({ logs: malformedSteps });
    await expect(repository.listForAutomation(automationId)).rejects.toEqual(
      new AppError('db_error')
    );

    const malformedTimestamp = logRows.map((row) => ({ ...row }));
    malformedTimestamp[0].created_at = '2026-10-19 10:00:00';
    setupTransactions({ logs: malformedTimestamp });
    await expect(repository.listForAutomation(automationId)).rejects.toEqual(
      new AppError('db_error')
    );
  });

  it('hides driver errors behind the safe database error', async () => {
    setupTransactions();
    const repository = createPostgresAutomationLogsRepository(
      async () => sessionA
    );
    const databaseFailure = new AppError('db_error');
    mocks.withTransaction
      .mockResolvedValueOnce(dbSuccess(membershipA))
      .mockResolvedValueOnce(dbFailure(databaseFailure));
    await expect(repository.listForAutomation(automationId)).rejects.toBe(
      databaseFailure
    );
  });
});
