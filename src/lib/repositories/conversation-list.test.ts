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
import { createPostgresConversationListRepository } from './conversation-list';

const sessionA = { userId: '00000000-0000-4000-8000-000000000001' };
const accountA = '10000000-0000-4000-8000-000000000001';
const contactA = '40000000-0000-4000-8000-000000000001';
const conversationA = '20000000-0000-4000-8000-000000000001';
const conversationRowA = {
  conversation_id: conversationA,
  conversation_user_id: sessionA.userId,
  conversation_contact_id: contactA,
  conversation_account_id: accountA,
  conversation_status: 'open',
  assigned_agent_id: null,
  last_message_text: 'synthetic latest message',
  last_message_at: new Date('2026-10-18T13:00:00.000Z'),
  unread_count: 2,
  conversation_created_at: new Date('2026-10-18T11:00:00.000Z'),
  conversation_updated_at: new Date('2026-10-18T13:00:00.000Z'),
  contact_id: contactA,
  contact_user_id: sessionA.userId,
  contact_account_id: accountA,
  contact_phone: '+15550000001',
  contact_phone_normalized: '15550000001',
  contact_name: 'Synthetic contact A',
  contact_email: 'contact-a@example.invalid',
  contact_company: 'Synthetic company',
  contact_avatar_url: null,
  contact_created_at: new Date('2026-10-18T10:00:00.000Z'),
  contact_updated_at: new Date('2026-10-18T10:00:00.000Z'),
};

const membershipA = {
  userId: sessionA.userId,
  accountId: accountA,
  role: 'viewer',
  accountName: 'Synthetic Account A',
};

function setupTransactions({
  role = 'viewer',
  conversationRows = [conversationRowA],
}: {
  role?: string;
  conversationRows?: Record<string, unknown>[];
} = {}) {
  const transactionQuery = vi.fn(
    async (...args: [sql: string, values?: readonly unknown[]]) => {
      const [sql] = args;
      if (sql.includes('set_config')) return { rows: [], rowCount: 1 };
      if (sql.includes('INNER JOIN public.accounts')) {
        return {
          rows: [{ ...membershipA, role }],
          rowCount: 1,
        };
      }
      if (sql.includes('FROM public.conversations AS c')) {
        return { rows: conversationRows, rowCount: conversationRows.length };
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

describe('PostgreSQL conversation list repository', () => {
  beforeEach(() => {
    mocks.withTransaction.mockReset();
  });

  it('requires a verified session before querying conversations', async () => {
    const repository = createPostgresConversationListRepository(
      async () => null
    );

    await expect(repository.listConversations()).rejects.toEqual(
      new AppError('unauthorized')
    );
    expect(mocks.withTransaction).not.toHaveBeenCalled();
  });

  it('allows viewers and maps scoped conversations with their contact projection', async () => {
    const query = setupTransactions();
    const repository = createPostgresConversationListRepository(
      async () => sessionA
    );

    await expect(repository.listConversations()).resolves.toEqual([
      {
        id: conversationA,
        user_id: sessionA.userId,
        contact_id: contactA,
        status: 'open',
        last_message_text: 'synthetic latest message',
        last_message_at: '2026-10-18T13:00:00.000Z',
        unread_count: 2,
        created_at: '2026-10-18T11:00:00.000Z',
        updated_at: '2026-10-18T13:00:00.000Z',
        contact: {
          id: contactA,
          user_id: sessionA.userId,
          account_id: accountA,
          phone: '+15550000001',
          phone_normalized: '15550000001',
          name: 'Synthetic contact A',
          email: 'contact-a@example.invalid',
          company: 'Synthetic company',
          created_at: '2026-10-18T10:00:00.000Z',
          updated_at: '2026-10-18T10:00:00.000Z',
        },
      },
    ]);

    expect(query.mock.calls[0]).toEqual([
      "SELECT set_config('request.jwt.claim.sub', $1, true)",
      [sessionA.userId],
    ]);
    expect(query.mock.calls[2]).toEqual([
      "SELECT set_config('request.jwt.claim.sub', $1, true)",
      [sessionA.userId],
    ]);
    const [sql, values] = query.mock.calls[3] ?? [];
    expect(sql).toContain('INNER JOIN public.contacts AS ct');
    expect(sql).toMatch(/c\.account_id = \$1\s+AND ct\.account_id = \$1/);
    expect(sql).toContain('ORDER BY c.last_message_at DESC NULLS FIRST');
    expect(values).toEqual([accountA]);
  });

  it('returns an empty list when the account has no conversations', async () => {
    const query = setupTransactions({ conversationRows: [] });
    const repository = createPostgresConversationListRepository(
      async () => sessionA
    );

    await expect(repository.listConversations()).resolves.toEqual([]);
    expect(query.mock.calls[3]?.[1]).toEqual([accountA]);
  });

  it('rejects malformed joined rows safely', async () => {
    setupTransactions({
      conversationRows: [
        {
          ...conversationRowA,
          contact_account_id: '10000000-0000-4000-8000-000000000002',
        },
      ],
    });
    const repository = createPostgresConversationListRepository(
      async () => sessionA
    );

    await expect(repository.listConversations()).rejects.toEqual(
      new AppError('db_error')
    );
  });

  it('propagates safe database errors without exposing driver details', async () => {
    const databaseFailure = new AppError('db_error');
    mocks.withTransaction
      .mockResolvedValueOnce(dbSuccess(membershipA))
      .mockResolvedValueOnce(dbFailure(databaseFailure));
    const repository = createPostgresConversationListRepository(
      async () => sessionA
    );

    await expect(repository.listConversations()).rejects.toBe(databaseFailure);
  });
});
