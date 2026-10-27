import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  transactionQuery: vi.fn(),
  withTransaction: vi.fn(),
}));

vi.mock('../db/postgres-client', () => ({
  withTransaction: mocks.withTransaction,
}));
vi.mock('server-only', () => ({}));

import { createPostgresWhatsAppSendConversationRepository } from './whatsapp-send-conversation';

const userId = '00000000-0000-4000-8000-000000000001';
const accountId = '10000000-0000-4000-8000-000000000001';
const contactId = '40000000-0000-4000-8000-000000000001';
const acceptedPhone = '+15550000002';

describe('PostgreSQL WhatsApp send conversation repository', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.transactionQuery.mockResolvedValue({ rows: [] });
    mocks.withTransaction.mockImplementation(async (operation) => {
      try {
        const transaction = { query: mocks.transactionQuery };
        return { ok: true, data: await operation(transaction) };
      } catch (error) {
        return { ok: false, error };
      }
    });
  });

  it('updates only the selected contact in the verified account', async () => {
    mocks.transactionQuery.mockImplementation(async (sql) =>
      typeof sql === 'string' && sql.includes('UPDATE public.contacts')
        ? { rows: [{ id: contactId }] }
        : { rows: [] }
    );
    const repository = createPostgresWhatsAppSendConversationRepository({
      userId,
      accountId,
    });

    await expect(
      repository.updateContactPhone(contactId, acceptedPhone)
    ).resolves.toBe(true);

    expect(mocks.transactionQuery).toHaveBeenNthCalledWith(
      1,
      "SELECT set_config('request.jwt.claim.sub', $1, true)",
      [userId]
    );
    expect(mocks.transactionQuery).toHaveBeenNthCalledWith(
      2,
      expect.stringContaining('UPDATE public.contacts'),
      [contactId, accountId, acceptedPhone]
    );
  });

  it('returns false when RLS hides the contact from this account', async () => {
    const repository = createPostgresWhatsAppSendConversationRepository({
      userId,
      accountId,
    });

    await expect(
      repository.updateContactPhone(contactId, acceptedPhone)
    ).resolves.toBe(false);

    expect(mocks.transactionQuery).toHaveBeenCalledWith(
      expect.stringContaining('UPDATE public.contacts'),
      [contactId, accountId, acceptedPhone]
    );
  });

  it('updates the last-message snapshot in the verified account', async () => {
    const conversationId = '20000000-0000-4000-8000-000000000001';
    const lastMessageText = 'synthetic outbound message';
    const lastMessageAt = '2026-10-21T09:00:00.000Z';
    const updatedAt = '2026-10-21T09:00:00.001Z';
    mocks.transactionQuery.mockImplementation(async (sql) =>
      typeof sql === 'string' && sql.includes('UPDATE public.conversations')
        ? { rows: [{ id: conversationId }] }
        : { rows: [] }
    );
    const repository = createPostgresWhatsAppSendConversationRepository({
      userId,
      accountId,
    });

    await expect(
      repository.updateAfterSend({
        conversationId,
        lastMessageText,
        lastMessageAt,
        updatedAt,
      })
    ).resolves.toBe(true);

    expect(mocks.transactionQuery).toHaveBeenNthCalledWith(
      1,
      "SELECT set_config('request.jwt.claim.sub', $1, true)",
      [userId]
    );
    expect(mocks.transactionQuery).toHaveBeenNthCalledWith(
      2,
      expect.stringContaining('UPDATE public.conversations'),
      [conversationId, accountId, lastMessageText, lastMessageAt, updatedAt]
    );
  });

  it('returns false when RLS or account scope hides the conversation', async () => {
    const repository = createPostgresWhatsAppSendConversationRepository({
      userId,
      accountId,
    });

    await expect(
      repository.updateAfterSend({
        conversationId: '20000000-0000-4000-8000-000000000002',
        lastMessageText: 'synthetic outbound message',
        lastMessageAt: '2026-10-21T09:00:00.000Z',
        updatedAt: '2026-10-21T09:00:00.001Z',
      })
    ).resolves.toBe(false);

    expect(mocks.transactionQuery).toHaveBeenCalledWith(
      expect.stringContaining('UPDATE public.conversations'),
      [
        '20000000-0000-4000-8000-000000000002',
        accountId,
        'synthetic outbound message',
        '2026-10-21T09:00:00.000Z',
        '2026-10-21T09:00:00.001Z',
      ]
    );
  });
});
