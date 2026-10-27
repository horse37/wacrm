import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AppError } from '@/lib/db/errors';

const mocks = vi.hoisted(() => ({
  createClient: vi.fn(),
  createPostgresWhatsAppConfigRepository: vi.fn(),
  createPostgresTemplateSendDefinitionRepository: vi.fn(),
  decrypt: vi.fn(),
  sendTemplateMessage: vi.fn(),
  checkRateLimit: vi.fn(),
  rateLimitResponse: vi.fn(),
}));

vi.mock('@/lib/supabase/server', () => ({
  createClient: mocks.createClient,
}));
vi.mock('@/lib/repositories/whatsapp-config', () => ({
  createPostgresWhatsAppConfigRepository:
    mocks.createPostgresWhatsAppConfigRepository,
}));
vi.mock('@/lib/repositories/template-send-definition', () => ({
  createPostgresTemplateSendDefinitionRepository:
    mocks.createPostgresTemplateSendDefinitionRepository,
}));
vi.mock('@/lib/whatsapp/encryption', () => ({ decrypt: mocks.decrypt }));
vi.mock('@/lib/whatsapp/meta-api', () => ({
  sendTemplateMessage: mocks.sendTemplateMessage,
}));
vi.mock('@/lib/rate-limit', () => ({
  checkRateLimit: mocks.checkRateLimit,
  rateLimitResponse: mocks.rateLimitResponse,
  RATE_LIMITS: { broadcast: { limit: 1 } },
}));

import { POST } from './route';

const userId = '00000000-0000-4000-8000-000000000001';
const templateId = '20000000-0000-4000-8000-000000000001';
const syntheticToken = 'SYNTHETIC_ACCESS_TOKEN';
const syntheticPhoneNumberId = 'SYNTHETIC_PHONE_NUMBER_ID';
const syntheticMessageId = 'SYNTHETIC_META_MESSAGE_ID';
const config = {
  phoneNumberId: syntheticPhoneNumberId,
  encryptedAccessToken: 'SYNTHETIC_CIPHERTEXT',
  status: 'connected' as const,
};
const template = {
  id: templateId,
  user_id: userId,
  name: 'synthetic_reminder',
  category: 'Utility' as const,
  body_text: 'Olá {{1}}',
  created_at: '2026-10-20T12:00:00.000Z',
  header_type: 'text' as const,
  header_content: 'Aviso',
  header_media_url: null,
  buttons: null,
};

function setup({
  user = { id: userId },
  connectionConfig = config,
  templateDefinition = template,
  configRepositoryError,
  templateRepositoryError,
}: {
  user?: { id: string } | null;
  connectionConfig?: typeof config | null;
  templateDefinition?: typeof template | null;
  configRepositoryError?: Error;
  templateRepositoryError?: Error;
} = {}) {
  const legacyFrom = vi.fn();
  mocks.createClient.mockResolvedValue({
    auth: {
      getUser: vi.fn(async () => ({
        data: { user },
        error: user ? null : new Error('Synthetic unauthenticated session'),
      })),
    },
    from: legacyFrom,
  });
  const getConnectionConfig = vi.fn(async () => {
    if (configRepositoryError) throw configRepositoryError;
    return connectionConfig;
  });
  const findForCurrentAccount = vi.fn(async () => {
    if (templateRepositoryError) throw templateRepositoryError;
    return templateDefinition;
  });
  mocks.createPostgresWhatsAppConfigRepository.mockReturnValue({
    getConnectionConfig,
  });
  mocks.createPostgresTemplateSendDefinitionRepository.mockReturnValue({
    findForCurrentAccount,
  });
  mocks.decrypt.mockReturnValue(syntheticToken);
  mocks.sendTemplateMessage.mockResolvedValue({
    messageId: syntheticMessageId,
  });
  mocks.checkRateLimit.mockReturnValue({ success: true });

  return {
    legacyFrom,
    getConnectionConfig,
    findForCurrentAccount,
  };
}

function request(body: unknown): Request {
  return new Request('http://localhost/api/whatsapp/broadcast', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

describe('POST /api/whatsapp/broadcast PostgreSQL reads', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('uses account-scoped PostgreSQL configuration and template before sending', async () => {
    const { legacyFrom, getConnectionConfig, findForCurrentAccount } = setup();

    const response = await POST(
      request({
        recipients: [{ phone: '+14155550123', params: ['Ana'] }],
        template_name: template.name,
        template_language: 'pt_BR',
      })
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      success: true,
      total: 1,
      sent: 1,
      failed: 0,
      results: [
        {
          phone: '+14155550123',
          status: 'sent',
          whatsapp_message_id: syntheticMessageId,
        },
      ],
    });
    expect(mocks.createPostgresWhatsAppConfigRepository).toHaveBeenCalledOnce();
    expect(
      mocks.createPostgresTemplateSendDefinitionRepository
    ).toHaveBeenCalledOnce();
    const configSessionVerifier =
      mocks.createPostgresWhatsAppConfigRepository.mock.calls[0][0];
    const templateSessionVerifier =
      mocks.createPostgresTemplateSendDefinitionRepository.mock.calls[0][0];
    expect(configSessionVerifier).toBe(templateSessionVerifier);
    await expect(configSessionVerifier()).resolves.toEqual({ userId });
    expect(getConnectionConfig).toHaveBeenCalledOnce();
    expect(findForCurrentAccount).toHaveBeenCalledWith({
      name: template.name,
      language: 'pt_BR',
    });
    expect(legacyFrom).not.toHaveBeenCalled();
    expect(mocks.decrypt).toHaveBeenCalledWith(config.encryptedAccessToken);
    expect(mocks.sendTemplateMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        phoneNumberId: syntheticPhoneNumberId,
        accessToken: syntheticToken,
        to: '14155550123',
        templateName: template.name,
        language: 'pt_BR',
        template: expect.objectContaining({
          id: templateId,
          name: template.name,
          body_text: template.body_text,
        }),
        params: ['Ana'],
      })
    );
  });

  it('rejects an unauthenticated session before PostgreSQL or provider access', async () => {
    const { legacyFrom } = setup({ user: null });

    const response = await POST(request({}));

    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: 'Unauthorized' });
    expect(mocks.createPostgresWhatsAppConfigRepository).not.toHaveBeenCalled();
    expect(
      mocks.createPostgresTemplateSendDefinitionRepository
    ).not.toHaveBeenCalled();
    expect(legacyFrom).not.toHaveBeenCalled();
    expect(mocks.sendTemplateMessage).not.toHaveBeenCalled();
  });

  it('returns a safe forbidden response when the PostgreSQL guard rejects the session', async () => {
    const { legacyFrom, getConnectionConfig } = setup({
      configRepositoryError: new AppError('forbidden'),
    });

    const response = await POST(
      request({
        recipients: [{ phone: '+14155550123', params: [] }],
        template_name: template.name,
      })
    );

    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({
      error: 'The operation is not allowed.',
    });
    expect(getConnectionConfig).toHaveBeenCalledOnce();
    expect(
      mocks.createPostgresTemplateSendDefinitionRepository
    ).not.toHaveBeenCalled();
    expect(legacyFrom).not.toHaveBeenCalled();
    expect(mocks.sendTemplateMessage).not.toHaveBeenCalled();
  });

  it('preserves the not-configured response and skips the template lookup', async () => {
    const { getConnectionConfig } = setup({ connectionConfig: null });

    const response = await POST(
      request({
        recipients: [{ phone: '+14155550123', params: [] }],
        template_name: template.name,
      })
    );

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      error:
        'WhatsApp not configured. Please set up your WhatsApp integration first.',
    });
    expect(getConnectionConfig).toHaveBeenCalledOnce();
    expect(
      mocks.createPostgresTemplateSendDefinitionRepository
    ).not.toHaveBeenCalled();
    expect(mocks.decrypt).not.toHaveBeenCalled();
    expect(mocks.sendTemplateMessage).not.toHaveBeenCalled();
  });

  it('applies the existing rate limit before PostgreSQL access', async () => {
    setup();
    const rateLimit = { success: false };
    const limitedResponse = new Response(
      JSON.stringify({ error: 'Rate limited' }),
      {
        status: 429,
        headers: { 'content-type': 'application/json' },
      }
    );
    mocks.checkRateLimit.mockReturnValue(rateLimit);
    mocks.rateLimitResponse.mockReturnValue(limitedResponse);

    const response = await POST(
      request({
        recipients: [{ phone: '+14155550123', params: [] }],
        template_name: template.name,
      })
    );

    expect(response).toBe(limitedResponse);
    expect(mocks.checkRateLimit).toHaveBeenCalledWith(`broadcast:${userId}`, {
      limit: 1,
    });
    expect(mocks.createPostgresWhatsAppConfigRepository).not.toHaveBeenCalled();
    expect(
      mocks.createPostgresTemplateSendDefinitionRepository
    ).not.toHaveBeenCalled();
    expect(mocks.sendTemplateMessage).not.toHaveBeenCalled();
  });

  it('returns a safe database error when the template repository fails', async () => {
    setup({ templateRepositoryError: new AppError('db_error') });

    const response = await POST(
      request({
        recipients: [{ phone: '+14155550123', params: [] }],
        template_name: template.name,
      })
    );

    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({
      error: 'The database operation failed.',
    });
    expect(mocks.sendTemplateMessage).not.toHaveBeenCalled();
  });
});
