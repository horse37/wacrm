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
import { createPostgresBroadcastDetailRepository } from './broadcast-detail';

const sessionA = { userId: '00000000-0000-4000-8000-000000000003' };
const accountA = '10000000-0000-4000-8000-000000000001';
const broadcastId = '30000000-0000-4000-8000-000000000003';
const broadcastRows: Record<string, unknown>[] = [
  {
    id: broadcastId,
    name: 'Synthetic campaign',
    template_name: 'appointment_reminder',
    status: 'sending',
    total_recipients: 10,
    sent_count: 7,
    delivered_count: 4,
    read_count: 2,
    replied_count: 1,
    failed_count: 0,
    created_at: '2026-10-20T10:00:00.000Z',
  },
];
const recipientRows: Record<string, unknown>[] = [
  {
    id: '40000000-0000-4000-8000-000000000003',
    broadcast_id: broadcastId,
    contact_id: '50000000-0000-4000-8000-000000000001',
    status: 'delivered',
    sent_at: '2026-10-20T10:01:00.000Z',
    delivered_at: '2026-10-20T10:02:00.000Z',
    read_at: null,
    replied_at: null,
    error_message: null,
    joined_contact_id: '50000000-0000-4000-8000-000000000001',
    contact_name: 'Synthetic Contact',
    contact_phone: '15550000001',
  },
  {
    id: '40000000-0000-4000-8000-000000000002',
    broadcast_id: broadcastId,
    contact_id: null,
    status: 'failed',
    sent_at: null,
    delivered_at: null,
    read_at: null,
    replied_at: null,
    error_message: 'Synthetic delivery error',
    joined_contact_id: null,
    contact_name: null,
    contact_phone: null,
  },
];

function setupTransactions({
  role = 'viewer',
  broadcasts = broadcastRows,
  recipients = recipientRows,
}: {
  role?: string;
  broadcasts?: Record<string, unknown>[];
  recipients?: Record<string, unknown>[];
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
      if (sql.includes('FROM public.broadcasts AS b')) {
        return { rows: broadcasts, rowCount: broadcasts.length };
      }
      if (sql.includes('FROM public.broadcast_recipients AS r')) {
        return { rows: recipients, rowCount: recipients.length };
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

describe('PostgreSQL broadcast-detail repository', () => {
  beforeEach(() => {
    mocks.withTransaction.mockReset();
  });

  it('requires verified account membership before reading detail', async () => {
    const repository = createPostgresBroadcastDetailRepository(
      async () => null
    );

    await expect(repository.getForBroadcast(broadcastId)).rejects.toEqual(
      new AppError('unauthorized')
    );
    expect(mocks.withTransaction).not.toHaveBeenCalled();
  });

  it('rejects an invalid broadcast UUID before opening the detail transaction', async () => {
    setupTransactions();
    const repository = createPostgresBroadcastDetailRepository(
      async () => sessionA
    );

    await expect(repository.getForBroadcast('bad-id')).rejects.toEqual(
      new AppError('bad_request')
    );
    expect(mocks.withTransaction).toHaveBeenCalledTimes(1);
  });

  it('returns a validated header and recipient summaries for a viewer', async () => {
    setupTransactions({ role: 'viewer' });
    const repository = createPostgresBroadcastDetailRepository(
      async () => sessionA
    );

    await expect(repository.getForBroadcast(broadcastId)).resolves.toEqual({
      broadcast: {
        id: broadcastId,
        name: 'Synthetic campaign',
        template_name: 'appointment_reminder',
        status: 'sending',
        total_recipients: 10,
        sent_count: 7,
        delivered_count: 4,
        read_count: 2,
        replied_count: 1,
        failed_count: 0,
        created_at: '2026-10-20T10:00:00.000Z',
      },
      recipients: [
        {
          id: '40000000-0000-4000-8000-000000000003',
          status: 'delivered',
          sent_at: '2026-10-20T10:01:00.000Z',
          delivered_at: '2026-10-20T10:02:00.000Z',
          read_at: null,
          replied_at: null,
          error_message: null,
          contact: { name: 'Synthetic Contact', phone: '15550000001' },
        },
        {
          id: '40000000-0000-4000-8000-000000000002',
          status: 'failed',
          sent_at: null,
          delivered_at: null,
          read_at: null,
          replied_at: null,
          error_message: 'Synthetic delivery error',
          contact: null,
        },
      ],
    });
  });

  it('uses explicit account/parent/creator/contact scope and minimal projections', async () => {
    const query = setupTransactions();
    const repository = createPostgresBroadcastDetailRepository(
      async () => sessionA
    );

    await repository.getForBroadcast(broadcastId);

    const parent = query.mock.calls.find(([sql]) =>
      sql.includes('FROM public.broadcasts AS b')
    );
    expect(parent?.[0]).toContain('b.account_id = $1');
    expect(parent?.[0]).toContain('b.id = $2');
    expect(parent?.[0]).toContain('WHERE b.account_id = $1');
    expect(parent?.[0]).not.toContain('public.profiles AS creator');
    expect(parent?.[0]).not.toContain('SELECT *');
    expect(parent?.[0]).not.toContain('template_variables');
    expect(parent?.[0]).not.toContain('audience_filter');
    expect(parent?.[1]).toEqual([accountA, broadcastId]);

    const recipients = query.mock.calls.find(([sql]) =>
      sql.includes('FROM public.broadcast_recipients AS r')
    );
    expect(recipients?.[0]).toContain('r.broadcast_id = $1');
    expect(recipients?.[0]).toContain('b.id = $1');
    expect(recipients?.[0]).toContain('b.account_id = $2');
    expect(recipients?.[0]).not.toContain('public.profiles AS creator');
    expect(recipients?.[0]).toContain('c.account_id = b.account_id');
    expect(recipients?.[0]).toContain('ORDER BY r.created_at DESC, r.id DESC');
    expect(recipients?.[0]).not.toContain('whatsapp_message_id');
    expect(recipients?.[0]).not.toContain('c.email');
    expect(recipients?.[1]).toEqual([broadcastId, accountA]);
    expect(
      query.mock.calls.filter(
        ([sql, values]) =>
          sql === "SELECT set_config('request.jwt.claim.sub', $1, true)" &&
          values?.[0] === sessionA.userId
      )
    ).toHaveLength(2);
  });

  it('returns not_found for a broadcast outside the account or without a valid creator', async () => {
    setupTransactions({ broadcasts: [] });
    const repository = createPostgresBroadcastDetailRepository(
      async () => sessionA
    );

    await expect(repository.getForBroadcast(broadcastId)).rejects.toEqual(
      new AppError('not_found')
    );
    expect(mocks.withTransaction).toHaveBeenCalledTimes(2);
  });

  it('returns an empty recipient list for a broadcast with no recipients', async () => {
    setupTransactions({ recipients: [] });
    const repository = createPostgresBroadcastDetailRepository(
      async () => sessionA
    );

    await expect(
      repository.getForBroadcast(broadcastId)
    ).resolves.toMatchObject({
      broadcast: { id: broadcastId },
      recipients: [],
    });
  });

  it('does not attach a contact from outside the broadcast account', async () => {
    const recipients = [
      {
        ...recipientRows[0],
        contact_id: '50000000-0000-4000-8000-000000000002',
        joined_contact_id: null,
        contact_name: null,
        contact_phone: null,
      },
    ];
    setupTransactions({ recipients });
    const repository = createPostgresBroadcastDetailRepository(
      async () => sessionA
    );

    await expect(
      repository.getForBroadcast(broadcastId)
    ).resolves.toMatchObject({
      recipients: [{ id: recipientRows[0].id, contact: null }],
    });
  });

  it.each([
    ['invalid broadcast ID', 'broadcasts', { id: 'bad-id' }],
    ['invalid status', 'broadcasts', { status: 'paused' }],
    ['negative broadcast count', 'broadcasts', { sent_count: -1 }],
    ['fractional recipient count', 'broadcasts', { total_recipients: 1.5 }],
    ['invalid broadcast timestamp', 'broadcasts', { created_at: 'invalid' }],
    ['invalid recipient ID', 'recipients', { id: 'bad-id' }],
    ['invalid recipient status', 'recipients', { status: 'queued' }],
    ['invalid event timestamp', 'recipients', { delivered_at: 'invalid' }],
    [
      'invalid joined contact ID',
      'recipients',
      { joined_contact_id: 'bad-id' },
    ],
  ])('fails closed for %s', async (_label, source, invalidFields) => {
    const broadcasts = broadcastRows.map((row) => ({ ...row }));
    const recipients = recipientRows.map((row) => ({ ...row }));
    if (source === 'broadcasts') {
      broadcasts[0] = { ...broadcasts[0], ...invalidFields };
    } else {
      recipients[0] = { ...recipients[0], ...invalidFields };
    }
    setupTransactions({ broadcasts, recipients });
    const repository = createPostgresBroadcastDetailRepository(
      async () => sessionA
    );

    await expect(repository.getForBroadcast(broadcastId)).rejects.toEqual(
      new AppError('db_error')
    );
  });

  it('propagates safe database errors without driver details', async () => {
    const databaseFailure = new AppError('db_error');
    mocks.withTransaction
      .mockResolvedValueOnce(
        dbSuccess({
          userId: sessionA.userId,
          accountId: accountA,
          role: 'viewer',
          accountName: 'Synthetic Account A',
        })
      )
      .mockResolvedValueOnce(dbFailure(databaseFailure));
    const repository = createPostgresBroadcastDetailRepository(
      async () => sessionA
    );

    await expect(repository.getForBroadcast(broadcastId)).rejects.toBe(
      databaseFailure
    );
  });
});
