import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AppError } from '@/lib/db/errors';

const mocks = vi.hoisted(() => ({
  createClient: vi.fn(),
  createPostgresWhatsAppConfigRepository: vi.fn(),
  createPostgresWhatsAppSendMessageRepository: vi.fn(),
  createPostgresWhatsAppSendFlowRunRepository: vi.fn(),
  insertSentMessage: vi.fn(),
  pauseActiveForAgentReply: vi.fn(),
  getConnectionConfig: vi.fn(),
  upgradeLegacyToken: vi.fn(),
  createDefaultPostgresAccountGuards: vi.fn(),
  requireAccount: vi.fn(),
  from: vi.fn(),
  withTransaction: vi.fn(),
  transactionQuery: vi.fn(),
  sendTextMessage: vi.fn(),
  sendTemplateMessage: vi.fn(),
  decrypt: vi.fn(),
  encrypt: vi.fn(),
  isLegacyFormat: vi.fn(),
  phoneVariants: vi.fn(),
  checkRateLimit: vi.fn(),
  rateLimitResponse: vi.fn(),
  sanitizePhoneForMeta: vi.fn(),
  isValidE164: vi.fn(),
}));

vi.mock('@/lib/supabase/server', () => ({
  createClient: mocks.createClient,
}));
vi.mock('@/lib/auth/postgres-account-guard', () => ({
  createDefaultPostgresAccountGuards: mocks.createDefaultPostgresAccountGuards,
}));
vi.mock('@/lib/repositories/whatsapp-config', () => ({
  createPostgresWhatsAppConfigRepository:
    mocks.createPostgresWhatsAppConfigRepository,
}));
vi.mock('@/lib/repositories/whatsapp-send-message', () => ({
  createPostgresWhatsAppSendMessageRepository:
    mocks.createPostgresWhatsAppSendMessageRepository,
}));
vi.mock('@/lib/repositories/whatsapp-send-flow-run', () => ({
  createPostgresWhatsAppSendFlowRunRepository:
    mocks.createPostgresWhatsAppSendFlowRunRepository,
}));
vi.mock('@/lib/db/postgres-client', () => ({
  withTransaction: mocks.withTransaction,
}));
vi.mock('server-only', () => ({}));
vi.mock('@/lib/rate-limit', () => ({
  checkRateLimit: mocks.checkRateLimit,
  rateLimitResponse: mocks.rateLimitResponse,
  RATE_LIMITS: { send: { limit: 5 } },
}));
vi.mock('@/lib/whatsapp/meta-api', () => ({
  sendTextMessage: mocks.sendTextMessage,
  sendTemplateMessage: mocks.sendTemplateMessage,
  sendMediaMessage: vi.fn(),
}));
vi.mock('@/lib/whatsapp/encryption', () => ({
  decrypt: mocks.decrypt,
  encrypt: mocks.encrypt,
  isLegacyFormat: mocks.isLegacyFormat,
}));
vi.mock('@/lib/whatsapp/phone-utils', () => ({
  sanitizePhoneForMeta: mocks.sanitizePhoneForMeta,
  isValidE164: mocks.isValidE164,
  phoneVariants: mocks.phoneVariants,
  isRecipientNotAllowedError: vi.fn(),
}));
import { POST } from './route';

const userId = '00000000-0000-4000-8000-000000000001';
const accountId = '10000000-0000-4000-8000-000000000001';

function makeRequest(body: unknown = { message_type: 'text' }) {
  return new Request('http://localhost/api/whatsapp/send', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

function makeClient(user: { id: string } | null) {
  return {
    auth: {
      getUser: vi.fn().mockResolvedValue({
        data: { user },
        error: null,
      }),
    },
    from: mocks.from,
  };
}

describe('POST /api/whatsapp/send account resolution', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.createClient.mockResolvedValue(makeClient({ id: userId }));
    mocks.from.mockReturnValue(undefined);
    mocks.transactionQuery.mockResolvedValue({ rows: [] });
    mocks.withTransaction.mockImplementation(async (operation) => {
      const transaction = { query: mocks.transactionQuery };
      return { ok: true, data: await operation(transaction) };
    });
    mocks.checkRateLimit.mockReturnValue({ success: true });
    mocks.rateLimitResponse.mockReturnValue(
      new Response(null, { status: 429 })
    );
    mocks.requireAccount.mockResolvedValue({
      userId,
      accountId,
      role: 'admin',
      account: { id: accountId, name: 'Synthetic account' },
    });
    mocks.createDefaultPostgresAccountGuards.mockReturnValue({
      requireAccount: mocks.requireAccount,
    });
    mocks.createPostgresWhatsAppConfigRepository.mockReturnValue({
      getConnectionConfig: mocks.getConnectionConfig,
      upgradeLegacyToken: mocks.upgradeLegacyToken,
    });
    mocks.createPostgresWhatsAppSendMessageRepository.mockReturnValue({
      insertSentMessage: mocks.insertSentMessage,
    });
    mocks.createPostgresWhatsAppSendFlowRunRepository.mockReturnValue({
      pauseActiveForAgentReply: mocks.pauseActiveForAgentReply,
    });
    mocks.pauseActiveForAgentReply.mockResolvedValue(false);
    mocks.insertSentMessage.mockResolvedValue(
      '70000000-0000-4000-8000-000000000001'
    );
    mocks.getConnectionConfig.mockResolvedValue({
      configId: '60000000-0000-4000-8000-000000000001',
      phoneNumberId: 'synthetic-phone-number-id',
      encryptedAccessToken: 'synthetic-encrypted-access-token',
      status: 'connected',
    });
    mocks.upgradeLegacyToken.mockResolvedValue(false);
    mocks.decrypt.mockReturnValue('synthetic-decrypted-access-token');
    mocks.encrypt.mockReturnValue('synthetic-reencrypted-access-token');
    mocks.isLegacyFormat.mockReturnValue(false);
  });

  function mockReplyScenario(providerMessageId: string | null) {
    const conversationId = '20000000-0000-4000-8000-000000000001';
    const contactId = '40000000-0000-4000-8000-000000000001';
    const replyToMessageId = '50000000-0000-4000-8000-000000000001';
    mocks.transactionQuery.mockImplementation(async (sql) => ({
      rows:
        typeof sql === 'string' &&
        sql.includes('FROM public.conversations AS c')
          ? [
              {
                conversation_id: conversationId,
                conversation_account_id: accountId,
                contact_id: contactId,
                contact_account_id: accountId,
                contact_phone: '+15550000001',
              },
            ]
          : typeof sql === 'string' && sql.includes('FROM public.messages AS m')
            ? [
                {
                  message_record_id: replyToMessageId,
                  conversation_id: conversationId,
                  provider_message_id: providerMessageId,
                },
              ]
            : [],
    }));
    mocks.sanitizePhoneForMeta.mockReturnValue('+15550000001');
    mocks.isValidE164.mockReturnValue(true);
    mocks.phoneVariants.mockReturnValue(['+15550000001']);
    mocks.decrypt.mockReturnValue('synthetic-decrypted-access-token');
    mocks.isLegacyFormat.mockReturnValue(false);
    mocks.sendTextMessage.mockRejectedValue(
      new Error('synthetic Meta send failure')
    );

    return { conversationId, replyToMessageId };
  }

  it('rejects missing session before resolving account', async () => {
    mocks.createClient.mockResolvedValue(makeClient(null));

    const response = await POST(makeRequest());

    expect(response.status).toBe(401);
    expect(mocks.createDefaultPostgresAccountGuards).not.toHaveBeenCalled();
    expect(mocks.from).not.toHaveBeenCalled();
  });

  it('preserves the 403 response when verified user has no account', async () => {
    mocks.requireAccount.mockRejectedValueOnce(new AppError('forbidden'));

    const response = await POST(makeRequest());

    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({
      error: 'Your profile is not linked to an account.',
    });
    expect(mocks.createDefaultPostgresAccountGuards).toHaveBeenCalledOnce();
    expect(mocks.from).not.toHaveBeenCalled();
  });

  it('uses verified session identity for PostgreSQL guard before body validation', async () => {
    const response = await POST(makeRequest());

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      error: 'conversation_id and message_type are required',
    });
    expect(mocks.createDefaultPostgresAccountGuards).toHaveBeenCalledOnce();
    const getVerifiedSession =
      mocks.createDefaultPostgresAccountGuards.mock.calls[0][0];
    await expect(getVerifiedSession()).resolves.toEqual({ userId });
    expect(mocks.requireAccount).toHaveBeenCalledOnce();
    expect(mocks.from).not.toHaveBeenCalled();
  });

  it('returns 404 for a missing conversation without reading it through Supabase', async () => {
    const conversationId = '20000000-0000-4000-8000-000000000001';
    const query = {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      single: vi.fn().mockResolvedValue({
        data: null,
        error: new Error('synthetic missing conversation'),
      }),
    };
    mocks.from.mockReturnValue(query);

    const response = await POST(
      makeRequest({
        conversation_id: conversationId,
        message_type: 'text',
        content_text: 'synthetic message',
      })
    );

    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: 'Conversation not found' });
    expect(mocks.from).not.toHaveBeenCalledWith('conversations');
    expect(mocks.transactionQuery).toHaveBeenNthCalledWith(
      1,
      expect.stringContaining('set_config'),
      [userId]
    );
    expect(mocks.transactionQuery).toHaveBeenNthCalledWith(
      2,
      expect.stringContaining('c.account_id = $2'),
      [conversationId, accountId]
    );
  });

  it('uses the PostgreSQL contact phone before reading the WhatsApp configuration', async () => {
    const conversationId = '20000000-0000-4000-8000-000000000001';
    const contactId = '40000000-0000-4000-8000-000000000001';
    mocks.transactionQuery.mockImplementation(async (sql) => ({
      rows:
        typeof sql === 'string' &&
        sql.includes('FROM public.conversations AS c')
          ? [
              {
                conversation_id: conversationId,
                conversation_account_id: accountId,
                contact_id: contactId,
                contact_account_id: accountId,
                contact_phone: '+15550000001',
              },
            ]
          : [],
    }));
    mocks.sanitizePhoneForMeta.mockReturnValue('+15550000001');
    mocks.isValidE164.mockReturnValue(true);
    mocks.getConnectionConfig.mockResolvedValueOnce(null);

    const response = await POST(
      makeRequest({
        conversation_id: conversationId,
        message_type: 'text',
        content_text: 'synthetic message',
      })
    );

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      error:
        'WhatsApp not configured. Please set up your WhatsApp integration first.',
    });
    expect(mocks.getConnectionConfig).toHaveBeenCalledOnce();
    expect(mocks.createPostgresWhatsAppConfigRepository).toHaveBeenCalledWith(
      expect.any(Function)
    );
    expect(mocks.from).not.toHaveBeenCalledWith('whatsapp_config');
    expect(mocks.from).not.toHaveBeenCalledWith('conversations');
    expect(mocks.transactionQuery).toHaveBeenNthCalledWith(
      2,
      expect.stringContaining('c.account_id = $2'),
      [conversationId, accountId]
    );
  });

  it('keeps legacy token upgrade in PostgreSQL and best-effort', async () => {
    const { conversationId } = mockReplyScenario(null);
    mocks.isLegacyFormat.mockReturnValue(true);
    mocks.upgradeLegacyToken.mockResolvedValue(true);

    const response = await POST(
      makeRequest({
        conversation_id: conversationId,
        message_type: 'text',
        content_text: 'synthetic message',
      })
    );

    expect(response.status).toBe(502);
    expect(mocks.getConnectionConfig).toHaveBeenCalledOnce();
    expect(mocks.encrypt).toHaveBeenCalledWith(
      'synthetic-decrypted-access-token'
    );
    expect(mocks.upgradeLegacyToken).toHaveBeenCalledWith(
      '60000000-0000-4000-8000-000000000001',
      'synthetic-reencrypted-access-token'
    );
    expect(mocks.from).not.toHaveBeenCalledWith('whatsapp_config');
  });
  it('does not wait for the legacy token upgrade before completing the send', async () => {
    const { conversationId } = mockReplyScenario(null);
    let resolveUpgrade: (updated: boolean) => void = () => {};
    mocks.isLegacyFormat.mockReturnValue(true);
    mocks.upgradeLegacyToken.mockReturnValue(
      new Promise((resolve) => {
        resolveUpgrade = resolve;
      })
    );

    const response = await POST(
      makeRequest({
        conversation_id: conversationId,
        message_type: 'text',
        content_text: 'synthetic message',
      })
    );
    resolveUpgrade(false);

    expect(response.status).toBe(502);
    expect(mocks.upgradeLegacyToken).toHaveBeenCalledOnce();
  });

  it('logs only a safe error when legacy token upgrade fails', async () => {
    const { conversationId } = mockReplyScenario(null);
    const warning = vi.spyOn(console, 'warn').mockImplementation(() => {});
    mocks.isLegacyFormat.mockReturnValue(true);
    mocks.upgradeLegacyToken.mockRejectedValue(
      new Error('synthetic private database detail')
    );

    try {
      const response = await POST(
        makeRequest({
          conversation_id: conversationId,
          message_type: 'text',
          content_text: 'synthetic message',
        })
      );

      expect(response.status).toBe(502);
      expect(warning).toHaveBeenCalledWith(
        '[whatsapp/send] access_token GCM upgrade failed:',
        'The database operation failed.'
      );
      expect(warning).not.toHaveBeenCalledWith(
        expect.anything(),
        expect.stringContaining('synthetic private database detail')
      );
    } finally {
      warning.mockRestore();
    }
  });
  it.each([
    {
      requestedLanguage: 'pt_BR',
      expectedLanguage: 'pt_BR',
      definitionFound: true,
    },
    {
      requestedLanguage: undefined,
      expectedLanguage: 'en_US',
      definitionFound: true,
    },
    {
      requestedLanguage: 'en_US',
      expectedLanguage: 'en_US',
      definitionFound: false,
    },
  ])(
    'uses PostgreSQL template definition for the verified account in $expectedLanguage (found: $definitionFound)',
    async ({ requestedLanguage, expectedLanguage, definitionFound }) => {
      const conversationId = '20000000-0000-4000-8000-000000000001';
      const contactId = '40000000-0000-4000-8000-000000000001';
      const templateName = 'Appointment reminder';
      mocks.transactionQuery.mockImplementation(async (sql) => ({
        rows:
          typeof sql === 'string' &&
          sql.includes('FROM public.conversations AS c')
            ? [
                {
                  conversation_id: conversationId,
                  conversation_account_id: accountId,
                  contact_id: contactId,
                  contact_account_id: accountId,
                  contact_phone: '+15550000001',
                },
              ]
            : typeof sql === 'string' &&
                sql.includes('FROM public.message_templates AS template') &&
                definitionFound
              ? [
                  {
                    id: '70000000-0000-4000-8000-000000000001',
                    userId,
                    name: templateName,
                    category: 'Utility',
                    bodyText: 'Synthetic appointment at {{1}}',
                    createdAt: '2026-10-20 12:00:00+00',
                    headerType: null,
                    headerContent: null,
                    headerMediaUrl: null,
                    buttons: [],
                  },
                ]
              : [],
      }));
      mocks.sanitizePhoneForMeta.mockReturnValue('+15550000001');
      mocks.isValidE164.mockReturnValue(true);
      mocks.phoneVariants.mockReturnValue(['+15550000001']);
      mocks.sendTemplateMessage.mockRejectedValue(
        new Error('synthetic provider failure')
      );

      const response = await POST(
        makeRequest({
          conversation_id: conversationId,
          message_type: 'template',
          template_name: templateName,
          template_language: requestedLanguage,
        })
      );

      expect(response.status).toBe(502);
      expect(mocks.getConnectionConfig).toHaveBeenCalledOnce();
      expect(mocks.from).not.toHaveBeenCalledWith('whatsapp_config');
      expect(mocks.transactionQuery).toHaveBeenCalledWith(
        expect.stringContaining('FROM public.message_templates AS template'),
        [accountId, templateName, expectedLanguage]
      );
      expect(mocks.from).not.toHaveBeenCalledWith('message_templates');
      expect(mocks.sendTemplateMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          phoneNumberId: 'synthetic-phone-number-id',
          accessToken: 'synthetic-decrypted-access-token',
          templateName,
          language: expectedLanguage,
          template: definitionFound
            ? expect.objectContaining({
                name: templateName,
                body_text: 'Synthetic appointment at {{1}}',
              })
            : undefined,
        })
      );
    }
  );

  it('looks up reply targets in PostgreSQL scoped to the verified account', async () => {
    const conversationId = '20000000-0000-4000-8000-000000000001';
    const contactId = '40000000-0000-4000-8000-000000000001';
    const replyToMessageId = '50000000-0000-4000-8000-000000000001';
    mocks.transactionQuery.mockImplementation(async (sql) => ({
      rows:
        typeof sql === 'string' &&
        sql.includes('FROM public.conversations AS c')
          ? [
              {
                conversation_id: conversationId,
                conversation_account_id: accountId,
                contact_id: contactId,
                contact_account_id: accountId,
                contact_phone: '+15550000001',
              },
            ]
          : [],
    }));
    mocks.sanitizePhoneForMeta.mockReturnValue('+15550000001');
    mocks.isValidE164.mockReturnValue(true);
    const replyQuery = {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      maybeSingle: vi.fn().mockResolvedValue({
        data: null,
        error: null,
      }),
    };
    mocks.from.mockImplementation((table) => {
      if (table === 'messages') return replyQuery;
      return undefined;
    });

    const response = await POST(
      makeRequest({
        conversation_id: conversationId,
        reply_to_message_id: replyToMessageId,
        message_type: 'text',
        content_text: 'synthetic message',
      })
    );

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      error: 'reply_to_message_id not found in this conversation',
    });
    expect(mocks.from).not.toHaveBeenCalledWith('messages');
    expect(mocks.transactionQuery).toHaveBeenCalledWith(
      expect.stringContaining('FROM public.messages AS m'),
      [replyToMessageId, conversationId, accountId]
    );
  });

  it('sends without reply context when the parent has no Meta message id', async () => {
    const { conversationId, replyToMessageId } = mockReplyScenario(null);

    const response = await POST(
      makeRequest({
        conversation_id: conversationId,
        reply_to_message_id: replyToMessageId,
        message_type: 'text',
        content_text: 'synthetic message',
      })
    );

    expect(response.status).toBe(502);
    expect(mocks.sendTextMessage).toHaveBeenCalledWith(
      expect.objectContaining({ contextMessageId: undefined })
    );
    expect(mocks.from).not.toHaveBeenCalledWith('messages');
  });

  it('forwards the parent Meta message id as reply context', async () => {
    const { conversationId, replyToMessageId } = mockReplyScenario(
      'wamid.synthetic-parent'
    );

    const response = await POST(
      makeRequest({
        conversation_id: conversationId,
        reply_to_message_id: replyToMessageId,
        message_type: 'text',
        content_text: 'synthetic message',
      })
    );

    expect(response.status).toBe(502);
    expect(mocks.sendTextMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        contextMessageId: 'wamid.synthetic-parent',
      })
    );
    expect(mocks.from).not.toHaveBeenCalledWith('messages');
  });

  it('returns 400 for a conversation without a contact and skips WhatsApp config', async () => {
    const conversationId = '20000000-0000-4000-8000-000000000001';
    mocks.transactionQuery.mockImplementation(async (sql) => ({
      rows:
        typeof sql === 'string' &&
        sql.includes('FROM public.conversations AS c')
          ? [
              {
                conversation_id: conversationId,
                conversation_account_id: accountId,
                contact_id: null,
                contact_account_id: null,
                contact_phone: null,
              },
            ]
          : [],
    }));

    const response = await POST(
      makeRequest({
        conversation_id: conversationId,
        message_type: 'text',
        content_text: 'synthetic message',
      })
    );

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      error: 'Contact phone number not found',
    });
    expect(mocks.from).not.toHaveBeenCalledWith('whatsapp_config');
    expect(mocks.sanitizePhoneForMeta).not.toHaveBeenCalled();
  });

  it('returns 400 for a contact without a phone before reading WhatsApp config', async () => {
    const conversationId = '20000000-0000-4000-8000-000000000001';
    const contactId = '40000000-0000-4000-8000-000000000001';
    mocks.transactionQuery.mockImplementation(async (sql) => ({
      rows:
        typeof sql === 'string' &&
        sql.includes('FROM public.conversations AS c')
          ? [
              {
                conversation_id: conversationId,
                conversation_account_id: accountId,
                contact_id: contactId,
                contact_account_id: accountId,
                contact_phone: null,
              },
            ]
          : [],
    }));

    const response = await POST(
      makeRequest({
        conversation_id: conversationId,
        message_type: 'text',
        content_text: 'synthetic message',
      })
    );

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      error: 'Contact phone number not found',
    });
    expect(mocks.from).not.toHaveBeenCalledWith('whatsapp_config');
    expect(mocks.sanitizePhoneForMeta).not.toHaveBeenCalled();
  });

  it('returns 400 for an invalid contact phone before reading WhatsApp config', async () => {
    const conversationId = '20000000-0000-4000-8000-000000000001';
    const contactId = '40000000-0000-4000-8000-000000000001';
    mocks.transactionQuery.mockImplementation(async (sql) => ({
      rows:
        typeof sql === 'string' &&
        sql.includes('FROM public.conversations AS c')
          ? [
              {
                conversation_id: conversationId,
                conversation_account_id: accountId,
                contact_id: contactId,
                contact_account_id: accountId,
                contact_phone: 'synthetic-invalid-phone',
              },
            ]
          : [],
    }));
    mocks.sanitizePhoneForMeta.mockReturnValue('synthetic-invalid-phone');
    mocks.isValidE164.mockReturnValue(false);

    const response = await POST(
      makeRequest({
        conversation_id: conversationId,
        message_type: 'text',
        content_text: 'synthetic message',
      })
    );

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      error: 'Invalid phone number format',
    });
    expect(mocks.sanitizePhoneForMeta).toHaveBeenCalledWith(
      'synthetic-invalid-phone'
    );
    expect(mocks.isValidE164).toHaveBeenCalledWith('synthetic-invalid-phone');
    expect(mocks.from).not.toHaveBeenCalledWith('whatsapp_config');
  });

  it('keeps a successful send when PostgreSQL cannot auto-correct the contact phone', async () => {
    const conversationId = '20000000-0000-4000-8000-000000000001';
    const contactId = '40000000-0000-4000-8000-000000000001';
    const originalPhone = '+15550000001';
    const acceptedPhone = '+15550000002';
    mocks.transactionQuery.mockImplementation(async (sql) => {
      if (
        typeof sql === 'string' &&
        sql.includes('FROM public.conversations AS c')
      ) {
        return {
          rows: [
            {
              conversation_id: conversationId,
              conversation_account_id: accountId,
              contact_id: contactId,
              contact_account_id: accountId,
              contact_phone: originalPhone,
            },
          ],
        };
      }
      if (typeof sql === 'string' && sql.includes('UPDATE public.contacts')) {
        throw new Error('synthetic database failure');
      }
      return { rows: [] };
    });
    mocks.withTransaction.mockImplementation(async (operation) => {
      try {
        const transaction = { query: mocks.transactionQuery };
        return { ok: true, data: await operation(transaction) };
      } catch {
        return { ok: false, error: new AppError('db_error') };
      }
    });
    mocks.sanitizePhoneForMeta.mockReturnValue(originalPhone);
    mocks.isValidE164.mockReturnValue(true);
    mocks.phoneVariants.mockReturnValue([acceptedPhone]);
    mocks.sendTextMessage.mockResolvedValue({
      messageId: 'wamid.synthetic-sent',
    });
    const postgrestQuery = {
      eq: vi.fn().mockReturnThis(),
      insert: vi.fn().mockReturnThis(),
      select: vi.fn().mockReturnThis(),
      single: vi.fn().mockResolvedValue({
        data: { id: '70000000-0000-4000-8000-000000000001' },
        error: null,
      }),
      update: vi.fn().mockReturnThis(),
    };
    mocks.from.mockReturnValue(postgrestQuery);

    const response = await POST(
      makeRequest({
        conversation_id: conversationId,
        message_type: 'text',
        content_text: 'synthetic message',
      })
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      success: true,
      message_id: '70000000-0000-4000-8000-000000000001',
      whatsapp_message_id: 'wamid.synthetic-sent',
    });
    expect(mocks.insertSentMessage).toHaveBeenCalledWith({
      conversationId,
      contentType: 'text',
      contentText: 'synthetic message',
      mediaUrl: null,
      templateName: null,
      providerMessageId: 'wamid.synthetic-sent',
      replyToMessageId: null,
    });
    expect(mocks.sendTextMessage.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.insertSentMessage.mock.invocationCallOrder[0]
    );
    expect(mocks.from).not.toHaveBeenCalledWith('messages');
    expect(mocks.transactionQuery).toHaveBeenCalledWith(
      expect.stringContaining('UPDATE public.contacts'),
      [contactId, accountId, acceptedPhone]
    );
    expect(mocks.from).not.toHaveBeenCalledWith('contacts');
  });

  it('returns the existing persistence error response after accepted send when message insert fails', async () => {
    const { conversationId } = mockReplyScenario(null);
    mocks.sendTextMessage.mockResolvedValue({
      messageId: 'wamid.synthetic-sent',
    });
    mocks.insertSentMessage.mockRejectedValue(new AppError('db_error'));

    const response = await POST(
      makeRequest({
        conversation_id: conversationId,
        message_type: 'text',
        content_text: 'synthetic message',
      })
    );

    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({
      error:
        'Message sent to Meta but failed to save to DB: The database operation failed.',
    });
    expect(mocks.sendTextMessage.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.insertSentMessage.mock.invocationCallOrder[0]
    );
    expect(mocks.from).not.toHaveBeenCalledWith('messages');
  });

  it('pauses an active flow before a provider rejection and does not persist the message', async () => {
    const { conversationId } = mockReplyScenario(null);
    mocks.pauseActiveForAgentReply.mockResolvedValue(true);

    const response = await POST(
      makeRequest({
        conversation_id: conversationId,
        message_type: 'text',
        content_text: 'synthetic message',
      })
    );

    expect(response.status).toBe(502);
    expect(mocks.insertSentMessage).not.toHaveBeenCalled();
    expect(mocks.pauseActiveForAgentReply).toHaveBeenCalledOnce();
    expect(
      mocks.pauseActiveForAgentReply.mock.invocationCallOrder[0]
    ).toBeLessThan(mocks.sendTextMessage.mock.invocationCallOrder[0]);
  });

  it('updates the conversation in PostgreSQL after the provider accepts send', async () => {
    const { conversationId } = mockReplyScenario(null);
    mocks.sendTextMessage.mockResolvedValue({
      messageId: 'wamid.synthetic-sent',
    });

    const response = await POST(
      makeRequest({
        conversation_id: conversationId,
        message_type: 'text',
        content_text: 'synthetic message',
      })
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ success: true });
    const updateIndex = mocks.transactionQuery.mock.calls.findIndex(
      ([sql]) =>
        typeof sql === 'string' && sql.includes('UPDATE public.conversations')
    );
    expect(updateIndex).toBeGreaterThanOrEqual(0);
    expect(mocks.transactionQuery).toHaveBeenNthCalledWith(
      updateIndex + 1,
      expect.stringContaining('UPDATE public.conversations'),
      [
        conversationId,
        accountId,
        'synthetic message',
        expect.any(String),
        expect.any(String),
      ]
    );
    expect(mocks.sendTextMessage.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.transactionQuery.mock.invocationCallOrder[updateIndex]
    );
    expect(mocks.from).not.toHaveBeenCalledWith('conversations');
  });

  it('keeps accepted send successful when PostgreSQL conversation update fails', async () => {
    const { conversationId } = mockReplyScenario(null);
    const originalQuery = mocks.transactionQuery.getMockImplementation();
    mocks.transactionQuery.mockImplementation(async (sql, params) => {
      if (
        typeof sql === 'string' &&
        sql.includes('UPDATE public.conversations')
      ) {
        throw new Error('synthetic database failure');
      }
      return originalQuery ? originalQuery(sql, params) : { rows: [] };
    });
    mocks.sendTextMessage.mockResolvedValue({
      messageId: 'wamid.synthetic-sent',
    });

    const response = await POST(
      makeRequest({
        conversation_id: conversationId,
        message_type: 'text',
        content_text: 'synthetic message',
      })
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ success: true });
    expect(mocks.transactionQuery).toHaveBeenCalledWith(
      expect.stringContaining('UPDATE public.conversations'),
      expect.any(Array)
    );
  });

  it('pauses the active Flow run before sending to the provider', async () => {
    const { conversationId } = mockReplyScenario(null);
    mocks.sendTextMessage.mockResolvedValue({
      messageId: 'wamid.synthetic-sent',
    });
    mocks.pauseActiveForAgentReply.mockResolvedValue(true);

    const response = await POST(
      makeRequest({
        conversation_id: conversationId,
        message_type: 'text',
        content_text: 'synthetic message',
      })
    );

    expect(response.status).toBe(200);
    expect(
      mocks.createPostgresWhatsAppSendFlowRunRepository
    ).toHaveBeenCalledWith({
      userId,
      accountId,
    });
    expect(mocks.pauseActiveForAgentReply).toHaveBeenCalledWith(
      '40000000-0000-4000-8000-000000000001',
      expect.any(String)
    );
    expect(
      mocks.pauseActiveForAgentReply.mock.invocationCallOrder[0]
    ).toBeLessThan(mocks.sendTextMessage.mock.invocationCallOrder[0]);
    expect(mocks.from).not.toHaveBeenCalledWith('flow_runs');
  });

  it('blocks provider send when PostgreSQL cannot confirm the Flow pause', async () => {
    const { conversationId } = mockReplyScenario(null);
    mocks.sendTextMessage.mockResolvedValue({
      messageId: 'wamid.synthetic-sent',
    });
    mocks.pauseActiveForAgentReply.mockRejectedValue(new AppError('db_error'));

    const response = await POST(
      makeRequest({
        conversation_id: conversationId,
        message_type: 'text',
        content_text: 'synthetic message',
      })
    );

    expect(response.status).toBe(503);
    expect(mocks.sendTextMessage).not.toHaveBeenCalled();
    expect(mocks.insertSentMessage).not.toHaveBeenCalled();
    expect(mocks.pauseActiveForAgentReply).toHaveBeenCalledOnce();
  });
});
