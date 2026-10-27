import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AppError, toAppError } from '../db/errors';

const mocks = vi.hoisted(() => ({
  transactionQuery: vi.fn(),
  withTransaction: vi.fn(),
}));

vi.mock('../db/postgres-client', () => ({
  withTransaction: mocks.withTransaction,
}));
vi.mock('server-only', () => ({}));

import { createPostgresWhatsAppSendMessageRepository } from './whatsapp-send-message';

const userId = '00000000-0000-4000-8000-000000000001';
const accountId = '10000000-0000-4000-8000-000000000001';
const conversationId = '20000000-0000-4000-8000-000000000001';
const messageId = '70000000-0000-4000-8000-000000000001';
const replyToMessageId = '50000000-0000-4000-8000-000000000001';

const message = {
  conversationId,
  contentType: 'text',
  contentText: 'synthetic outbound text',
  mediaUrl: null,
  templateName: null,
  providerMessageId: 'wamid.synthetic-sent',
  replyToMessageId,
};

describe('PostgreSQL WhatsApp sent message repository', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.transactionQuery.mockResolvedValue({ rows: [] });
    mocks.withTransaction.mockImplementation(async (operation) => {
      try {
        return {
          ok: true,
          data: await operation({ query: mocks.transactionQuery }),
        };
      } catch (error) {
        return { ok: false, error: toAppError(error) };
      }
    });
  });

  it('inserts the accepted message in the verified account and returns its local id', async () => {
    mocks.transactionQuery.mockImplementation(async (sql) =>
      typeof sql === 'string' && sql.includes('INSERT INTO public.messages')
        ? { rows: [{ id: messageId }] }
        : { rows: [] }
    );
    const repository = createPostgresWhatsAppSendMessageRepository({
      userId,
      accountId,
    });

    await expect(repository.insertSentMessage(message)).resolves.toBe(
      messageId
    );

    expect(mocks.transactionQuery).toHaveBeenNthCalledWith(
      1,
      "SELECT set_config('request.jwt.claim.sub', $1, true)",
      [userId]
    );
    expect(mocks.transactionQuery).toHaveBeenNthCalledWith(
      2,
      expect.stringContaining('INSERT INTO public.messages'),
      [
        conversationId,
        accountId,
        message.contentType,
        message.contentText,
        message.mediaUrl,
        message.templateName,
        message.providerMessageId,
        replyToMessageId,
      ]
    );
    expect(mocks.transactionQuery.mock.calls[1][0]).toContain(
      'FROM public.conversations'
    );
    expect(mocks.transactionQuery.mock.calls[1][0]).toContain(
      'RETURNING id::text AS id'
    );
  });

  it('stores absent optional values as null and allows a missing reply target', async () => {
    mocks.transactionQuery.mockImplementation(async (sql) =>
      typeof sql === 'string' && sql.includes('INSERT INTO public.messages')
        ? { rows: [{ id: messageId }] }
        : { rows: [] }
    );
    const repository = createPostgresWhatsAppSendMessageRepository({
      userId,
      accountId,
    });

    await expect(
      repository.insertSentMessage({
        ...message,
        contentType: 'image',
        contentText: null,
        mediaUrl: null,
        templateName: null,
        replyToMessageId: null,
      })
    ).resolves.toBe(messageId);

    expect(mocks.transactionQuery).toHaveBeenCalledWith(
      expect.stringContaining('INSERT INTO public.messages'),
      [
        conversationId,
        accountId,
        'image',
        null,
        null,
        null,
        message.providerMessageId,
        null,
      ]
    );
  });

  it('rejects invalid conversation or reply UUIDs before opening a transaction', async () => {
    const repository = createPostgresWhatsAppSendMessageRepository({
      userId,
      accountId,
    });

    await expect(
      repository.insertSentMessage({ ...message, conversationId: 'invalid' })
    ).rejects.toMatchObject({ code: 'bad_request' });
    await expect(
      repository.insertSentMessage({ ...message, replyToMessageId: 'invalid' })
    ).rejects.toMatchObject({ code: 'bad_request' });
    expect(mocks.withTransaction).not.toHaveBeenCalled();
  });

  it('fails closed when RLS or account scoping returns no inserted row', async () => {
    const repository = createPostgresWhatsAppSendMessageRepository({
      userId,
      accountId,
    });

    await expect(repository.insertSentMessage(message)).rejects.toMatchObject({
      code: 'db_error',
    });
  });

  it('rejects malformed or ambiguous RETURNING rows', async () => {
    mocks.transactionQuery.mockImplementation(async (sql) =>
      typeof sql === 'string' && sql.includes('INSERT INTO public.messages')
        ? { rows: [{ id: 'invalid' }] }
        : { rows: [] }
    );
    const repository = createPostgresWhatsAppSendMessageRepository({
      userId,
      accountId,
    });

    await expect(repository.insertSentMessage(message)).rejects.toMatchObject({
      code: 'db_error',
    });

    mocks.transactionQuery.mockImplementation(async (sql) =>
      typeof sql === 'string' && sql.includes('INSERT INTO public.messages')
        ? { rows: [{ id: messageId }, { id: messageId }] }
        : { rows: [] }
    );
    await expect(repository.insertSentMessage(message)).rejects.toMatchObject({
      code: 'db_error',
    });
  });

  it('maps raw database failures to a safe AppError', async () => {
    mocks.transactionQuery.mockRejectedValue(
      new Error('synthetic raw SQL detail')
    );
    const repository = createPostgresWhatsAppSendMessageRepository({
      userId,
      accountId,
    });

    await expect(repository.insertSentMessage(message)).rejects.toBeInstanceOf(
      AppError
    );
  });
});
