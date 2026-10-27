import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AppError } from '@/lib/db/errors';

const mocks = vi.hoisted(() => ({
  createClient: vi.fn(),
  createAdminClient: vi.fn(),
  legacyFrom: vi.fn(),
  createRepository: vi.fn(),
  getRegistrationState: vi.fn(),
  saveConnectionConfig: vi.fn(),
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
  decrypt: vi.fn(),
  encrypt: mocks.encrypt,
}));
vi.mock('@/lib/repositories/whatsapp-config', () => ({
  createPostgresWhatsAppConfigRepository: mocks.createRepository,
}));

import { POST } from './route';

const userId = '00000000-0000-4000-8000-000000000001';
const phoneInfo = {
  display_phone_number: '+15555550123',
  verified_name: 'Synthetic Test Number',
};

function makeRequest(
  body: unknown = {
    phone_number_id: 'synthetic-phone-id',
    waba_id: 'synthetic-waba-id',
    access_token: 'synthetic-access-token',
    verify_token: 'synthetic-verify-token',
    pin: '123456',
  }
) {
  return new Request('http://localhost/api/whatsapp/config', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

function legacyQueryResult(table: string) {
  let result: { data: unknown; error: null } = { data: null, error: null };
  const chain = {
    select: vi.fn(() => chain),
    eq: vi.fn(() => chain),
    neq: vi.fn(() => chain),
    maybeSingle: vi.fn(async () => {
      if (table === 'profiles') {
        result = {
          data: { account_id: '10000000-0000-4000-8000-000000000001' },
          error: null,
        };
      }
      return result;
    }),
    update: vi.fn(() => chain),
    insert: vi.fn(async () => ({ error: null })),
  };
  return chain;
}

function setup() {
  mocks.createClient.mockResolvedValue({
    auth: {
      getUser: vi.fn().mockResolvedValue({
        data: { user: { id: userId } },
        error: null,
      }),
    },
    from: mocks.legacyFrom,
  });
  mocks.legacyFrom.mockImplementation((table: string) =>
    legacyQueryResult(table === 'profiles' ? 'profiles' : 'whatsapp_config')
  );
  mocks.createAdminClient.mockReturnValue({
    from: vi.fn(() => {
      const query = legacyQueryResult('whatsapp_config');
      query.maybeSingle.mockResolvedValue({ data: null, error: null });
      return query;
    }),
  });
  mocks.createRepository.mockReturnValue({
    getRegistrationState: mocks.getRegistrationState,
    saveConnectionConfig: mocks.saveConnectionConfig,
  });
  mocks.getRegistrationState.mockResolvedValue(null);
  mocks.saveConnectionConfig.mockResolvedValue(undefined);
  mocks.encrypt.mockImplementation(
    (value: string) => `synthetic-encrypted:${value}`
  );
  mocks.registerPhoneNumber.mockResolvedValue(undefined);
  mocks.subscribeWabaToApp.mockResolvedValue(undefined);
  mocks.verifyPhoneNumber.mockResolvedValue(phoneInfo);
}

describe('POST /api/whatsapp/config', () => {
  beforeEach(() => {
    mocks.createClient.mockReset();
    mocks.createAdminClient.mockReset();
    mocks.legacyFrom.mockReset();
    mocks.createRepository.mockReset();
    mocks.getRegistrationState.mockReset();
    mocks.saveConnectionConfig.mockReset();
    mocks.encrypt.mockReset();
    mocks.registerPhoneNumber.mockReset();
    mocks.subscribeWabaToApp.mockReset();
    mocks.verifyPhoneNumber.mockReset();
    setup();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('requires the verified server session before repository or Meta work', async () => {
    mocks.createClient.mockResolvedValueOnce({
      auth: {
        getUser: vi.fn().mockResolvedValue({
          data: { user: null },
          error: null,
        }),
      },
      from: mocks.legacyFrom,
    });

    const response = await POST(makeRequest());

    expect(response.status).toBe(401);
    expect(mocks.createRepository).not.toHaveBeenCalled();
    expect(mocks.legacyFrom).not.toHaveBeenCalled();
    expect(mocks.createAdminClient).not.toHaveBeenCalled();
    expect(mocks.verifyPhoneNumber).not.toHaveBeenCalled();
  });

  it('reserves config in PostgreSQL before Meta mutation and preserves success response', async () => {
    const response = await POST(makeRequest());

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      success: true,
      saved: true,
      registered: true,
      registration_skipped: false,
      phone_info: phoneInfo,
    });
    expect(mocks.createRepository).toHaveBeenCalledOnce();
    const [getVerifiedSession] = mocks.createRepository.mock.calls[0] ?? [];
    await expect(getVerifiedSession()).resolves.toEqual({ userId });
    expect(mocks.getRegistrationState).toHaveBeenCalledOnce();
    expect(mocks.saveConnectionConfig).toHaveBeenCalledTimes(2);
    expect(mocks.saveConnectionConfig.mock.calls[0]?.[0]).toMatchObject({
      phoneNumberId: 'synthetic-phone-id',
      wabaId: 'synthetic-waba-id',
      encryptedAccessToken: 'synthetic-encrypted:synthetic-access-token',
      encryptedVerifyToken: 'synthetic-encrypted:synthetic-verify-token',
      status: 'disconnected',
      connectedAt: null,
      registeredAt: null,
    });
    expect(mocks.saveConnectionConfig.mock.calls[1]?.[0]).toMatchObject({
      status: 'connected',
      registeredAt: expect.any(String),
      lastRegistrationError: null,
    });
    expect(mocks.legacyFrom).not.toHaveBeenCalled();
    expect(mocks.createAdminClient).not.toHaveBeenCalled();
    expect(mocks.verifyPhoneNumber.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.saveConnectionConfig.mock.invocationCallOrder[0] ?? Infinity
    );
    expect(mocks.saveConnectionConfig.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.registerPhoneNumber.mock.invocationCallOrder[0] ?? Infinity
    );
    expect(mocks.registerPhoneNumber.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.subscribeWabaToApp.mock.invocationCallOrder[0] ?? Infinity
    );
    expect(mocks.subscribeWabaToApp.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.saveConnectionConfig.mock.invocationCallOrder[1] ?? Infinity
    );
  });

  it('returns the existing conflict contract before registration or subscription', async () => {
    mocks.saveConnectionConfig.mockRejectedValueOnce(new AppError('conflict'));

    const response = await POST(makeRequest());

    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({
      error:
        'This WhatsApp phone number is already linked to another account on this instance. Each phone number can only be connected to one wacrm user.',
    });
    expect(mocks.verifyPhoneNumber).toHaveBeenCalledOnce();
    expect(mocks.registerPhoneNumber).not.toHaveBeenCalled();
    expect(mocks.subscribeWabaToApp).not.toHaveBeenCalled();
    expect(mocks.saveConnectionConfig).toHaveBeenCalledOnce();
    expect(mocks.legacyFrom).not.toHaveBeenCalled();
    expect(mocks.createAdminClient).not.toHaveBeenCalled();
  });

  it('rejects non-admin PostgreSQL membership before contacting Meta', async () => {
    mocks.getRegistrationState.mockRejectedValueOnce(
      new AppError('forbidden', undefined, 'insufficient_role')
    );

    const response = await POST(makeRequest());

    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({
      error:
        'Your account role does not allow managing WhatsApp configuration.',
    });
    expect(mocks.verifyPhoneNumber).not.toHaveBeenCalled();
    expect(mocks.registerPhoneNumber).not.toHaveBeenCalled();
    expect(mocks.subscribeWabaToApp).not.toHaveBeenCalled();
    expect(mocks.legacyFrom).not.toHaveBeenCalled();
  });

  it('returns 401 when the PostgreSQL repository rejects the session', async () => {
    mocks.getRegistrationState.mockRejectedValueOnce(
      new AppError('unauthorized')
    );

    const response = await POST(makeRequest());

    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: 'Unauthorized' });
    expect(mocks.verifyPhoneNumber).not.toHaveBeenCalled();
    expect(mocks.registerPhoneNumber).not.toHaveBeenCalled();
    expect(mocks.subscribeWabaToApp).not.toHaveBeenCalled();
  });

  it('returns an internal error for PostgreSQL permission or policy failures', async () => {
    const consoleError = vi
      .spyOn(console, 'error')
      .mockImplementation(() => {});
    mocks.getRegistrationState.mockRejectedValueOnce(
      new AppError('db_error', '42501')
    );

    const response = await POST(makeRequest());

    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({
      error: 'Failed to validate configuration',
    });
    expect(consoleError).toHaveBeenCalledOnce();
    expect(mocks.verifyPhoneNumber).not.toHaveBeenCalled();
  });

  it('returns validation failure when registration state lookup has a database error', async () => {
    const consoleError = vi
      .spyOn(console, 'error')
      .mockImplementation(() => {});
    mocks.getRegistrationState.mockRejectedValueOnce(new AppError('db_error'));

    const response = await POST(makeRequest());

    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({
      error: 'Failed to validate configuration',
    });
    expect(consoleError).toHaveBeenCalledOnce();
    expect(mocks.verifyPhoneNumber).not.toHaveBeenCalled();
  });

  it('preserves required-field and PIN validation before Meta mutation', async () => {
    const missingAccessToken = await POST(
      makeRequest({ phone_number_id: 'synthetic-phone-id' })
    );
    expect(missingAccessToken.status).toBe(400);
    expect(await missingAccessToken.json()).toEqual({
      error: 'access_token and phone_number_id are required',
    });
    expect(mocks.verifyPhoneNumber).not.toHaveBeenCalled();
    expect(mocks.saveConnectionConfig).not.toHaveBeenCalled();

    const invalidPin = await POST(
      makeRequest({
        phone_number_id: 'synthetic-phone-id',
        access_token: 'synthetic-access-token',
        pin: '12345',
      })
    );
    expect(invalidPin.status).toBe(400);
    expect(await invalidPin.json()).toEqual({
      error: 'PIN must be exactly 6 digits.',
    });
    expect(mocks.verifyPhoneNumber).not.toHaveBeenCalled();
    expect(mocks.saveConnectionConfig).not.toHaveBeenCalled();
  });

  it('does not reserve config when Meta credential verification fails', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    mocks.verifyPhoneNumber.mockRejectedValueOnce(
      new Error('synthetic Meta credential rejection')
    );

    const response = await POST(makeRequest());

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      error: 'Meta API error: synthetic Meta credential rejection',
    });
    expect(mocks.saveConnectionConfig).not.toHaveBeenCalled();
    expect(mocks.registerPhoneNumber).not.toHaveBeenCalled();
    expect(mocks.subscribeWabaToApp).not.toHaveBeenCalled();
  });

  it('does not reserve config when token encryption fails', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    mocks.encrypt.mockImplementationOnce(() => {
      throw new Error('synthetic encryption failure');
    });

    const response = await POST(makeRequest());

    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({
      error:
        'Failed to encrypt token. Check that ENCRYPTION_KEY is a valid 64-character hex string in your environment variables.',
    });
    expect(mocks.verifyPhoneNumber).toHaveBeenCalledOnce();
    expect(mocks.saveConnectionConfig).not.toHaveBeenCalled();
    expect(mocks.registerPhoneNumber).not.toHaveBeenCalled();
    expect(mocks.subscribeWabaToApp).not.toHaveBeenCalled();
  });

  it('saves a new Meta test number as connected but not registered without a PIN', async () => {
    const response = await POST(
      makeRequest({
        phone_number_id: 'synthetic-phone-id',
        waba_id: 'synthetic-waba-id',
        access_token: 'synthetic-access-token',
        verify_token: 'synthetic-verify-token',
      })
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      success: true,
      saved: true,
      registered: false,
      registration_skipped: true,
      phone_info: phoneInfo,
    });
    expect(mocks.saveConnectionConfig).toHaveBeenCalledTimes(2);
    expect(mocks.saveConnectionConfig.mock.calls[0]?.[0]).toMatchObject({
      status: 'disconnected',
      connectedAt: null,
      registeredAt: null,
    });
    expect(mocks.saveConnectionConfig.mock.calls[1]?.[0]).toMatchObject({
      status: 'connected',
      registeredAt: null,
      lastRegistrationError: null,
    });
    expect(mocks.registerPhoneNumber).not.toHaveBeenCalled();
    expect(mocks.subscribeWabaToApp).toHaveBeenCalledOnce();
  });

  it('does not re-register the same already-registered phone when PIN is omitted', async () => {
    mocks.getRegistrationState.mockResolvedValueOnce({
      phoneNumberId: 'synthetic-phone-id',
      registeredAt: '2026-10-19T12:00:00.000Z',
    });

    const response = await POST(
      makeRequest({
        phone_number_id: 'synthetic-phone-id',
        waba_id: 'synthetic-waba-id',
        access_token: 'synthetic-access-token',
        verify_token: 'synthetic-verify-token',
      })
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      success: true,
      registered: true,
      registration_skipped: false,
    });
    expect(mocks.saveConnectionConfig.mock.calls[0]?.[0]).toMatchObject({
      status: 'connected',
      registeredAt: '2026-10-19T12:00:00.000Z',
    });
    expect(mocks.registerPhoneNumber).not.toHaveBeenCalled();
  });

  it('does not preliminarily rewrite an existing phone when a PIN is rotated', async () => {
    mocks.getRegistrationState.mockResolvedValueOnce({
      phoneNumberId: 'synthetic-phone-id',
      registeredAt: '2026-10-19T12:00:00.000Z',
    });

    const response = await POST(makeRequest());

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ registered: true });
    expect(mocks.registerPhoneNumber).toHaveBeenCalledOnce();
    expect(mocks.saveConnectionConfig).toHaveBeenCalledOnce();
    expect(mocks.saveConnectionConfig.mock.calls[0]?.[0]).toMatchObject({
      phoneNumberId: 'synthetic-phone-id',
      status: 'connected',
      registeredAt: expect.any(String),
    });
  });

  it('does not carry registration state from a previous phone number', async () => {
    mocks.getRegistrationState.mockResolvedValueOnce({
      phoneNumberId: 'synthetic-previous-phone-id',
      registeredAt: '2026-10-19T12:00:00.000Z',
    });

    const response = await POST(
      makeRequest({
        phone_number_id: 'synthetic-new-phone-id',
        waba_id: 'synthetic-waba-id',
        access_token: 'synthetic-access-token',
      })
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      registered: false,
      registration_skipped: true,
    });
    expect(mocks.saveConnectionConfig.mock.calls[0]?.[0]).toMatchObject({
      phoneNumberId: 'synthetic-new-phone-id',
      registeredAt: null,
    });
    expect(mocks.registerPhoneNumber).not.toHaveBeenCalled();
  });

  it('skips WABA subscription when waba_id is absent', async () => {
    const response = await POST(
      makeRequest({
        phone_number_id: 'synthetic-phone-id',
        access_token: 'synthetic-access-token',
        pin: '123456',
      })
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ registered: true });
    expect(mocks.registerPhoneNumber).toHaveBeenCalledOnce();
    expect(mocks.subscribeWabaToApp).not.toHaveBeenCalled();
    expect(mocks.saveConnectionConfig).toHaveBeenCalledTimes(2);
    expect(mocks.saveConnectionConfig.mock.calls[1]?.[0]).toMatchObject({
      wabaId: null,
      status: 'connected',
    });
  });

  it('keeps the successful save when WABA subscription fails', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    mocks.subscribeWabaToApp.mockRejectedValueOnce(
      new Error('synthetic subscription rejection')
    );

    const response = await POST(makeRequest());

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ success: true, saved: true });
    expect(mocks.saveConnectionConfig).toHaveBeenCalledTimes(2);
    expect(mocks.saveConnectionConfig.mock.calls[1]?.[0]).toMatchObject({
      status: 'connected',
      subscribedAppsAt: null,
    });
  });

  it('does not prewrite an existing same-number config before the final save', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    mocks.getRegistrationState.mockResolvedValueOnce({
      phoneNumberId: 'synthetic-phone-id',
      registeredAt: '2026-10-19T12:00:00.000Z',
    });
    mocks.saveConnectionConfig.mockRejectedValueOnce(new AppError('db_error'));

    const response = await POST(
      makeRequest({
        phone_number_id: 'synthetic-phone-id',
        waba_id: 'synthetic-waba-id',
        access_token: 'synthetic-access-token',
      })
    );

    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({
      error: 'Failed to update configuration',
      partial_persistence: {
        reservation_persisted: false,
        final_configuration_persisted: false,
        configuration_state: 'same_number_path_no_prewrite',
        meta_registration: 'skipped',
        meta_subscription: 'completed',
      },
    });
    expect(mocks.saveConnectionConfig).toHaveBeenCalledOnce();
    expect(
      mocks.saveConnectionConfig.mock.invocationCallOrder[0]
    ).toBeGreaterThan(
      mocks.subscribeWabaToApp.mock.invocationCallOrder[0] ?? 0
    );
    expect(mocks.registerPhoneNumber).not.toHaveBeenCalled();
    expect(mocks.subscribeWabaToApp).toHaveBeenCalledOnce();
  });

  it('reports final-save failure and leaves a changed phone in its reservation state', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const previousConfig = {
      phoneNumberId: 'synthetic-previous-phone-id',
      status: 'connected',
      registeredAt: '2026-10-19T12:00:00.000Z',
    };
    let persistedConfig: unknown = previousConfig;
    mocks.getRegistrationState.mockResolvedValueOnce({
      phoneNumberId: previousConfig.phoneNumberId,
      registeredAt: previousConfig.registeredAt,
    });
    mocks.saveConnectionConfig
      .mockImplementationOnce(async (config: unknown) => {
        persistedConfig = config;
      })
      .mockRejectedValueOnce(new AppError('db_error'));

    const response = await POST(
      makeRequest({
        phone_number_id: 'synthetic-phone-id',
        waba_id: 'synthetic-waba-id',
        access_token: 'synthetic-access-token',
        verify_token: 'synthetic-verify-token',
        pin: '123456',
      })
    );

    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({
      error: 'Failed to update configuration',
      partial_persistence: {
        reservation_persisted: true,
        final_configuration_persisted: false,
        configuration_state: 'disconnected_reservation',
        meta_registration: 'completed',
        meta_subscription: 'completed',
      },
    });
    expect(mocks.saveConnectionConfig).toHaveBeenCalledTimes(2);
    expect(persistedConfig).not.toEqual(previousConfig);
    expect(persistedConfig).toMatchObject({
      phoneNumberId: 'synthetic-phone-id',
      status: 'disconnected',
      connectedAt: null,
      registeredAt: null,
      subscribedAppsAt: null,
    });
    expect(mocks.registerPhoneNumber).toHaveBeenCalledOnce();
    expect(mocks.subscribeWabaToApp).toHaveBeenCalledOnce();
  });

  it('returns a safe persistence failure before Meta mutation', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    mocks.saveConnectionConfig.mockRejectedValueOnce(new AppError('db_error'));

    const response = await POST(makeRequest());

    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({
      error: 'Failed to save configuration',
    });
    expect(mocks.registerPhoneNumber).not.toHaveBeenCalled();
    expect(mocks.subscribeWabaToApp).not.toHaveBeenCalled();
  });

  it('persists registration failure and preserves its successful-save response', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    mocks.registerPhoneNumber.mockRejectedValueOnce(
      new Error('synthetic Meta registration rejection')
    );

    const response = await POST(makeRequest());

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      success: false,
      saved: true,
      registered: false,
      registration_error: 'synthetic Meta registration rejection',
      phone_info: phoneInfo,
    });
    expect(mocks.saveConnectionConfig).toHaveBeenCalledTimes(2);
    expect(mocks.saveConnectionConfig.mock.calls[1]?.[0]).toMatchObject({
      status: 'disconnected',
      connectedAt: null,
      registeredAt: null,
      lastRegistrationError: 'synthetic Meta registration rejection',
    });
    expect(mocks.subscribeWabaToApp).toHaveBeenCalledOnce();
  });
});
