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
import { createPostgresConversationMessagesRepository } from './conversation-messages';

const sessionA = { userId: '00000000-0000-4000-8000-000000000001' };
const accountA = '10000000-0000-4000-8000-000000000001';
const conversationA = '20000000-0000-4000-8000-000000000001';
const messageA = {
  id: '30000000-0000-4000-8000-000000000001',
  conversation_id: conversationA,
  sender_type: 'customer',
  sender_id: null,
  content_type: 'text',
  content_text: 'synthetic message A',
  media_url: null,
  template_name: null,
  message_id: 'synthetic-meta-message-a',
  status: 'delivered',
  created_at: new Date('2026-10-18T12:00:00.000Z'),
  reply_to_message_id: null,
  interactive_reply_id: null,
};

const membershipA = {
  userId: sessionA.userId,
  accountId: accountA,
  role: 'viewer',
  accountName: 'Synthetic Account A',
};

function setupTransactions({
  role = 'viewer',
  messageRows = [messageA],
}: {
  role?: string;
  messageRows?: Record<string, unknown>[];
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
      if (sql.includes('FROM public.messages AS m')) {
        return { rows: messageRows, rowCount: messageRows.length };
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

describe('PostgreSQL conversation message repository', () => {
  beforeEach(() => {
    mocks.withTransaction.mockReset();
  });

  it('requires a verified session before querying message history', async () => {
    const repository = createPostgresConversationMessagesRepository(
      async () => null
    );

    await expect(repository.listForConversation(conversationA)).rejects.toEqual(
      new AppError('unauthorized')
    );
    expect(mocks.withTransaction).not.toHaveBeenCalled();
  });

  it('allows a viewer and binds conversation plus verified account scope', async () => {
    const query = setupTransactions();
    const repository = createPostgresConversationMessagesRepository(
      async () => sessionA
    );

    await expect(
      repository.listForConversation(conversationA)
    ).resolves.toEqual([
      {
        id: messageA.id,
        conversation_id: conversationA,
        sender_type: 'customer',
        content_type: 'text',
        content_text: 'synthetic message A',
        message_id: 'synthetic-meta-message-a',
        status: 'delivered',
        created_at: '2026-10-18T12:00:00.000Z',
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
    expect(sql).toContain('INNER JOIN public.conversations AS c');
    expect(sql).toMatch(/WHERE c\.id = \$1\s+AND c\.account_id = \$2/);
    expect(sql).toContain('ORDER BY m.created_at ASC');
    expect(values).toEqual([conversationA, accountA]);
  });

  it('returns an empty list for an absent or cross-account conversation', async () => {
    const query = setupTransactions({ messageRows: [] });
    const repository = createPostgresConversationMessagesRepository(
      async () => sessionA
    );

    await expect(
      repository.listForConversation(conversationA)
    ).resolves.toEqual([]);
    expect(query.mock.calls[3]?.[1]).toEqual([conversationA, accountA]);
  });

  it('rejects malformed conversation IDs without querying messages', async () => {
    const query = setupTransactions();
    const repository = createPostgresConversationMessagesRepository(
      async () => sessionA
    );

    await expect(repository.listForConversation('not-a-uuid')).rejects.toEqual(
      new AppError('not_found')
    );
    expect(
      query.mock.calls.some(([sql]) => sql.includes('public.messages'))
    ).toBe(false);
  });

  it('rejects malformed database message rows safely', async () => {
    setupTransactions({ messageRows: [{ ...messageA, status: 'queued' }] });
    const repository = createPostgresConversationMessagesRepository(
      async () => sessionA
    );

    await expect(repository.listForConversation(conversationA)).rejects.toEqual(
      new AppError('db_error')
    );
  });

  it('propagates safe database errors without exposing driver details', async () => {
    const databaseFailure = new AppError('db_error');
    mocks.withTransaction
      .mockResolvedValueOnce(dbSuccess(membershipA))
      .mockResolvedValueOnce(dbFailure(databaseFailure));
    const repository = createPostgresConversationMessagesRepository(
      async () => sessionA
    );

    await expect(repository.listForConversation(conversationA)).rejects.toBe(
      databaseFailure
    );
  });
});
