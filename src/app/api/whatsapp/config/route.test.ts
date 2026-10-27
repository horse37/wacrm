import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AppError } from '@/lib/db/errors';

const mocks = vi.hoisted(() => ({
  createClient: vi.fn(),
  createAdminClient: vi.fn(),
  legacyFrom: vi.fn(),
  createRepository: vi.fn(),
  getConnectionConfig: vi.fn(),
  decrypt: vi.fn(),
  encrypt: vi.fn(),
  registerPhoneNumber: vi.fn(),
  subscribeWabaToApp: vi.fn(),
  verifyPhoneNumber: vi.fn(),
}));

vi.mock('@/lib/supabase/server', () => ({
  createClient: mocks.createClient,
}));
vi.mock('@supabase/supabase-js', () => ({
  createClient: mocks.createAdminClient,
}));
vi.mock('@/lib/whatsapp/meta-api', () => ({
  registerPhoneNumber: mocks.registerPhoneNumber,
  subscribeWabaToApp: mocks.subscribeWabaToApp,
  verifyPhoneNumber: mocks.verifyPhoneNumber,
}));
vi.mock('@/lib/whatsapp/encryption', () => ({
  decrypt: mocks.decrypt,
  encrypt: mocks.encrypt,
}));
vi.mock('@/lib/repositories/whatsapp-config', () => ({
  createPostgresWhatsAppConfigRepository: mocks.createRepository,
}));

import { GET } from './route';

const userId = '00000000-0000-4000-8000-000000000001';
const phoneInfo = {
  id: 'synthetic-phone-id',
  display_phone_number: '+15555550123',
};
const connectionConfig = {
  phoneNumberId: 'synthetic-phone-id',
  encryptedAccessToken: 'synthetic-ciphertext',
  status: 'connected',
};

function getConfig() {
  return GET();
}

describe('GET /api/whatsapp/config', () => {
  beforeEach(() => {
    mocks.createClient.mockReset().mockResolvedValue({
      auth: {
        getUser: vi.fn().mockResolvedValue({
          data: { user: { id: userId } },
          error: null,
        }),
      },
      from: mocks.legacyFrom,
    });
    mocks.createAdminClient.mockReset();
    mocks.legacyFrom.mockReset();
    mocks.createRepository.mockReset().mockReturnValue({
      getConnectionConfig: mocks.getConnectionConfig,
    });
    mocks.getConnectionConfig.mockReset().mockResolvedValue(connectionConfig);
    mocks.decrypt.mockReset().mockReturnValue('synthetic-access-token');
    mocks.encrypt.mockReset();
    mocks.registerPhoneNumber.mockReset();
    mocks.subscribeWabaToApp.mockReset();
    mocks.verifyPhoneNumber.mockReset().mockResolvedValue(phoneInfo);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('requires the current server-verified session before reading config', async () => {
    mocks.createClient.mockResolvedValue({
      auth: {
        getUser: vi.fn().mockResolvedValue({
          data: { user: null },
          error: null,
        }),
      },
      from: mocks.legacyFrom,
    });

    const response = await getConfig();

    expect(response.status).toBe(401);
    expect(mocks.createRepository).not.toHaveBeenCalled();
    expect(mocks.legacyFrom).not.toHaveBeenCalled();
    expect(mocks.verifyPhoneNumber).not.toHaveBeenCalled();
  });

  it('loads encrypted config from PostgreSQL and verifies it with Meta', async () => {
    mocks.getConnectionConfig.mockResolvedValueOnce(connectionConfig);

    const response = await getConfig();

    expect(response.status).toBe(200);
    const payload = await response.json();
    expect(payload).toEqual({ connected: true, phone_info: phoneInfo });
    expect(mocks.createRepository).toHaveBeenCalledTimes(1);
    const [getVerifiedSession] = mocks.createRepository.mock.calls[0];
    await expect(getVerifiedSession()).resolves.toEqual({ userId });
    expect(mocks.getConnectionConfig).toHaveBeenCalledTimes(1);
    expect(mocks.decrypt).toHaveBeenCalledWith(
      connectionConfig.encryptedAccessToken
    );
    expect(mocks.verifyPhoneNumber).toHaveBeenCalledWith({
      phoneNumberId: connectionConfig.phoneNumberId,
      accessToken: 'synthetic-access-token',
    });
    expect(mocks.legacyFrom).not.toHaveBeenCalled();
    expect(JSON.stringify(payload)).not.toContain('synthetic-access-token');
  });

  it('preserves the no-account response when PostgreSQL membership is absent', async () => {
    mocks.getConnectionConfig.mockRejectedValueOnce(new AppError('forbidden'));

    const response = await getConfig();

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      connected: false,
      reason: 'no_account',
      message: 'Your profile is not linked to an account.',
    });
    expect(mocks.verifyPhoneNumber).not.toHaveBeenCalled();
    expect(mocks.legacyFrom).not.toHaveBeenCalled();
  });

  it('preserves the no-config response when account has no saved connection', async () => {
    mocks.getConnectionConfig.mockResolvedValueOnce(null);

    const response = await getConfig();

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      connected: false,
      reason: 'no_config',
      message:
        'No WhatsApp configuration saved yet. Fill in the form and click Save Configuration.',
    });
    expect(mocks.decrypt).not.toHaveBeenCalled();
    expect(mocks.verifyPhoneNumber).not.toHaveBeenCalled();
  });

  it('preserves the safe database-error response', async () => {
    const consoleError = vi
      .spyOn(console, 'error')
      .mockImplementation(() => {});
    mocks.getConnectionConfig.mockRejectedValueOnce(new AppError('db_error'));

    const response = await getConfig();

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      connected: false,
      reason: 'db_error',
      message: 'Failed to fetch configuration',
    });
    expect(consoleError).toHaveBeenCalledWith(
      'Error fetching whatsapp_config:',
      'The database operation failed.'
    );
    expect(mocks.verifyPhoneNumber).not.toHaveBeenCalled();
  });

  it('preserves the corrupted-token response without calling Meta', async () => {
    const consoleError = vi
      .spyOn(console, 'error')
      .mockImplementation(() => {});
    mocks.decrypt.mockImplementationOnce(() => {
      throw new Error('synthetic decryption detail');
    });

    const response = await getConfig();

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      connected: false,
      reason: 'token_corrupted',
      needs_reset: true,
    });
    expect(mocks.verifyPhoneNumber).not.toHaveBeenCalled();
    expect(consoleError).toHaveBeenCalledOnce();
  });

  it('preserves Meta verification failures without returning credential material', async () => {
    const consoleError = vi
      .spyOn(console, 'error')
      .mockImplementation(() => {});
    mocks.verifyPhoneNumber.mockRejectedValueOnce(
      new Error('synthetic Meta rejection')
    );

    const response = await getConfig();

    expect(response.status).toBe(200);
    const payload = await response.json();
    expect(payload).toEqual({
      connected: false,
      reason: 'meta_api_error',
      message: 'Meta API rejected the credentials: synthetic Meta rejection',
    });
    expect(consoleError).toHaveBeenCalledOnce();
    expect(JSON.stringify(payload)).not.toContain('synthetic-access-token');
  });
});
