import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { AppError } from '@/lib/db/errors';

const mocks = vi.hoisted(() => ({
  createClient: vi.fn(),
  getUser: vi.fn(),
  supabaseFrom: vi.fn(),
  createTargetRepository: vi.fn(),
  getTarget: vi.fn(),
  createConfigRepository: vi.fn(),
  getConnectionConfig: vi.fn(),
  createPersistenceRepository: vi.fn(),
  saveAgentReaction: vi.fn(),
  sendReactionMessage: vi.fn(),
  decrypt: vi.fn(),
  sanitizePhoneForMeta: vi.fn(),
  checkRateLimit: vi.fn(),
  rateLimitResponse: vi.fn(),
  reactLimit: { limit: 10, windowMs: 60_000 },
}));

vi.mock('@/lib/supabase/server', () => ({
  createClient: mocks.createClient,
}));

vi.mock('@/lib/repositories/message-reaction-target', () => ({
  createPostgresMessageReactionTargetRepository: mocks.createTargetRepository,
}));

vi.mock('@/lib/repositories/whatsapp-config', () => ({
  createPostgresWhatsAppConfigRepository: mocks.createConfigRepository,
}));

vi.mock('@/lib/repositories/message-reaction-persistence', () => ({
  createPostgresMessageReactionPersistenceRepository:
    mocks.createPersistenceRepository,
}));

vi.mock('@/lib/whatsapp/meta-api', () => ({
  sendReactionMessage: mocks.sendReactionMessage,
}));

vi.mock('@/lib/whatsapp/encryption', () => ({
  decrypt: mocks.decrypt,
}));

vi.mock('@/lib/whatsapp/phone-utils', () => ({
  sanitizePhoneForMeta: mocks.sanitizePhoneForMeta,
}));

vi.mock('@/lib/rate-limit', () => ({
  checkRateLimit: mocks.checkRateLimit,
  rateLimitResponse: mocks.rateLimitResponse,
  RATE_LIMITS: { react: mocks.reactLimit },
}));

import { POST } from './route';

const userId = '7d9d36e6-e4a8-4c1f-8f92-c8107c4a3d12';
const messageId = '965e9639-f97f-4a92-b4a2-6f385cd1a22c';
const providerMessageId = 'SYNTHETIC_PROVIDER_MESSAGE';
const target = {
  providerMessageId,
  contactPhone: '+15555550123',
};
const connectionConfig = {
  phoneNumberId: 'SYNTHETIC_PHONE_NUMBER_ID',
  encryptedAccessToken: 'synthetic-encrypted-token',
  status: 'connected',
};

function request(body: unknown = { message_id: messageId, emoji: '👍' }) {
  return new Request('https://wacrm.example.test/api/whatsapp/react', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

describe('POST /api/whatsapp/react PostgreSQL route', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, 'error').mockImplementation(() => {});
    mocks.createClient.mockResolvedValue({
      auth: { getUser: mocks.getUser },
      from: mocks.supabaseFrom,
    });
    mocks.getUser.mockResolvedValue({
      data: { user: { id: userId } },
      error: null,
    });
    mocks.supabaseFrom.mockImplementation(() => {
      throw new Error('Unexpected Supabase data access');
    });
    mocks.createTargetRepository.mockReturnValue({
      getTarget: mocks.getTarget,
    });
    mocks.createConfigRepository.mockReturnValue({
      getConnectionConfig: mocks.getConnectionConfig,
    });
    mocks.createPersistenceRepository.mockReturnValue({
      saveAgentReaction: mocks.saveAgentReaction,
    });
    mocks.getTarget.mockResolvedValue(target);
    mocks.getConnectionConfig.mockResolvedValue(connectionConfig);
    mocks.saveAgentReaction.mockResolvedValue(undefined);
    mocks.sendReactionMessage.mockResolvedValue(undefined);
    mocks.decrypt.mockReturnValue('synthetic-decrypted-token');
    mocks.sanitizePhoneForMeta.mockReturnValue('+15555550123');
    mocks.checkRateLimit.mockReturnValue({ success: true });
    mocks.rateLimitResponse.mockReturnValue(
      new Response(JSON.stringify({ error: 'Rate limit exceeded' }), {
        status: 429,
      })
    );
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('uses PostgreSQL context, sends to the provider, then persists the reaction', async () => {
    const response = await POST(request());

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ success: true });
    expect(mocks.getUser).toHaveBeenCalledOnce();
    expect(mocks.checkRateLimit).toHaveBeenCalledWith(
      `react:${userId}`,
      mocks.reactLimit
    );
    expect(mocks.createTargetRepository).toHaveBeenCalledWith(
      expect.any(Function)
    );
    expect(mocks.createConfigRepository).toHaveBeenCalledWith(
      expect.any(Function)
    );
    expect(mocks.createPersistenceRepository).toHaveBeenCalledWith(
      expect.any(Function)
    );
    for (const factory of [
      mocks.createTargetRepository,
      mocks.createConfigRepository,
      mocks.createPersistenceRepository,
    ]) {
      await expect(factory.mock.calls[0][0]()).resolves.toEqual({ userId });
    }
    expect(mocks.getTarget).toHaveBeenCalledWith(messageId);
    expect(mocks.getConnectionConfig).toHaveBeenCalledOnce();
    expect(mocks.decrypt).toHaveBeenCalledWith(
      connectionConfig.encryptedAccessToken
    );
    expect(mocks.sanitizePhoneForMeta).toHaveBeenCalledWith(
      target.contactPhone
    );
    expect(mocks.sendReactionMessage).toHaveBeenCalledWith({
      phoneNumberId: connectionConfig.phoneNumberId,
      accessToken: 'synthetic-decrypted-token',
      to: '+15555550123',
      targetMessageId: providerMessageId,
      emoji: '👍',
    });
    expect(mocks.sendReactionMessage.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.saveAgentReaction.mock.invocationCallOrder[0]
    );
    expect(mocks.saveAgentReaction).toHaveBeenCalledWith(messageId, '👍');
    expect(mocks.supabaseFrom).not.toHaveBeenCalled();
  });

  it('rejects an unauthenticated request before touching rate limits or repositories', async () => {
    mocks.getUser.mockResolvedValue({ data: { user: null }, error: null });

    const response = await POST(request());

    expect(response.status).toBe(401);
    expect(mocks.checkRateLimit).not.toHaveBeenCalled();
    expect(mocks.createTargetRepository).not.toHaveBeenCalled();
  });

  it('does not access repositories when the caller is rate limited', async () => {
    mocks.checkRateLimit.mockReturnValue({ success: false });

    const response = await POST(request());

    expect(response.status).toBe(429);
    expect(mocks.rateLimitResponse).toHaveBeenCalledWith({ success: false });
    expect(mocks.createTargetRepository).not.toHaveBeenCalled();
  });

  it('preserves the not-found response for an inaccessible message', async () => {
    mocks.getTarget.mockRejectedValue(new AppError('not_found'));

    const response = await POST(request());

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toEqual({
      error: 'Message not found',
    });
  });

  it('preserves the unsent-message response when provider ID is absent', async () => {
    mocks.getTarget.mockResolvedValue({
      providerMessageId: null,
      contactPhone: target.contactPhone,
    });

    const response = await POST(request());

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: 'Cannot react to a message that has not been sent to WhatsApp',
    });
    expect(mocks.sendReactionMessage).not.toHaveBeenCalled();
  });

  it('preserves the missing-phone response without contacting the provider', async () => {
    mocks.getTarget.mockResolvedValue({
      providerMessageId,
      contactPhone: null,
    });

    const response = await POST(request());

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: 'Contact phone number not found',
    });
    expect(mocks.sendReactionMessage).not.toHaveBeenCalled();
  });

  it('returns the existing configuration response when no account config exists', async () => {
    mocks.getConnectionConfig.mockResolvedValue(null);

    const response = await POST(request());

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: 'WhatsApp not configured.',
    });
    expect(mocks.sendReactionMessage).not.toHaveBeenCalled();
  });

  it('does not persist when the Meta provider rejects the reaction', async () => {
    mocks.sendReactionMessage.mockRejectedValue(
      new Error('temporary provider error')
    );

    const response = await POST(request());

    expect(response.status).toBe(502);
    await expect(response.json()).resolves.toEqual({
      error: 'Meta API error: temporary provider error',
    });
    expect(mocks.saveAgentReaction).not.toHaveBeenCalled();
  });

  it.each([
    ['👍', 'Reaction sent to Meta but DB upsert failed'],
    ['', 'Reaction sent to Meta but DB delete failed'],
  ])(
    'preserves the database failure response after provider success for emoji %s',
    async (emoji, errorMessage) => {
      mocks.saveAgentReaction.mockRejectedValue(new AppError('db_error'));

      const response = await POST(request({ message_id: messageId, emoji }));

      expect(response.status).toBe(500);
      await expect(response.json()).resolves.toEqual({ error: errorMessage });
      expect(mocks.sendReactionMessage).toHaveBeenCalledOnce();
      expect(mocks.saveAgentReaction).toHaveBeenCalledOnce();
      expect(
        mocks.sendReactionMessage.mock.invocationCallOrder[0]
      ).toBeLessThan(mocks.saveAgentReaction.mock.invocationCallOrder[0]);
    }
  );

  it('sends and persists an empty emoji as the actor reaction removal', async () => {
    const response = await POST(request({ message_id: messageId, emoji: '' }));

    expect(response.status).toBe(200);
    expect(mocks.sendReactionMessage).toHaveBeenCalledWith(
      expect.objectContaining({ emoji: '' })
    );
    expect(mocks.saveAgentReaction).toHaveBeenCalledWith(messageId, '');
  });
});
