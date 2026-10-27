import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AppError } from '@/lib/db/errors';

const mocks = vi.hoisted(() => ({
  createClient: vi.fn(),
  getUser: vi.fn(),
  supabaseFrom: vi.fn(),
  createRepository: vi.fn(),
  getRegistrationDiagnostics: vi.fn(),
  decrypt: vi.fn(),
  verifyPhoneNumber: vi.fn(),
  getSubscribedApps: vi.fn(),
}));

vi.mock('@/lib/supabase/server', () => ({
  createClient: mocks.createClient,
}));

vi.mock('@/lib/repositories/whatsapp-config', () => ({
  createPostgresWhatsAppConfigRepository: mocks.createRepository,
}));

vi.mock('@/lib/whatsapp/encryption', () => ({
  decrypt: mocks.decrypt,
}));

vi.mock('@/lib/whatsapp/meta-api', () => ({
  verifyPhoneNumber: mocks.verifyPhoneNumber,
  getSubscribedApps: mocks.getSubscribedApps,
}));

import { GET } from './route';

const userId = '00000000-0000-4000-8000-000000000001';
const config = {
  phoneNumberId: 'synthetic-phone-id',
  wabaId: 'synthetic-waba-id',
  encryptedAccessToken: 'synthetic-encrypted-access-token',
  registeredAt: '2026-10-20T12:00:00.000Z',
  subscribedAppsAt: '2026-10-20T12:01:00.000Z',
  lastRegistrationError: null,
};
const phoneInfo = { display_phone_number: '+15555550123' };

describe('GET /api/whatsapp/config/verify-registration PostgreSQL route', () => {
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
    mocks.createRepository.mockReturnValue({
      getRegistrationDiagnostics: mocks.getRegistrationDiagnostics,
    });
    mocks.getRegistrationDiagnostics.mockResolvedValue(config);
    mocks.decrypt.mockReturnValue('synthetic-access-token');
    mocks.verifyPhoneNumber.mockResolvedValue(phoneInfo);
    mocks.getSubscribedApps.mockResolvedValue([{ id: 'synthetic-app-id' }]);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('requires the existing verified session before PostgreSQL or Meta work', async () => {
    mocks.getUser.mockResolvedValueOnce({ data: { user: null }, error: null });

    const response = await GET();

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({ error: 'Unauthorized' });
    expect(mocks.createRepository).not.toHaveBeenCalled();
    expect(mocks.supabaseFrom).not.toHaveBeenCalled();
    expect(mocks.verifyPhoneNumber).not.toHaveBeenCalled();
    expect(mocks.getSubscribedApps).not.toHaveBeenCalled();
  });

  it('preserves the unlinked-account diagnostic without a Supabase data query', async () => {
    mocks.getRegistrationDiagnostics.mockRejectedValue(
      new AppError('forbidden')
    );

    const response = await GET();

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      live: false,
      checks: { config_exists: false },
      message: 'Your profile is not linked to an account.',
    });
    expect(mocks.supabaseFrom).not.toHaveBeenCalled();
  });

  it('returns the existing no-configuration diagnostic when PostgreSQL has no row', async () => {
    mocks.getRegistrationDiagnostics.mockResolvedValue(null);

    const response = await GET();

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      live: false,
      checks: { config_exists: false },
      message: 'No WhatsApp configuration saved yet.',
    });
    expect(mocks.verifyPhoneNumber).not.toHaveBeenCalled();
    expect(mocks.getSubscribedApps).not.toHaveBeenCalled();
  });

  it('uses account-scoped PostgreSQL state and preserves the successful diagnostic contract', async () => {
    const response = await GET();

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      live: true,
      checks: {
        config_exists: true,
        token_decryptable: true,
        phone_metadata_ok: true,
        waba_subscribed_to_app: true,
        locally_marked_registered: true,
      },
      errors: [],
      last_registration_error: null,
      registered_at: config.registeredAt,
      subscribed_apps_at: config.subscribedAppsAt,
    });
    expect(mocks.createRepository).toHaveBeenCalledOnce();
    const [getVerifiedSession] = mocks.createRepository.mock.calls[0] ?? [];
    await expect(getVerifiedSession()).resolves.toEqual({ userId });
    expect(mocks.getRegistrationDiagnostics).toHaveBeenCalledOnce();
    expect(mocks.decrypt).toHaveBeenCalledWith(config.encryptedAccessToken);
    expect(mocks.verifyPhoneNumber).toHaveBeenCalledWith({
      phoneNumberId: config.phoneNumberId,
      accessToken: 'synthetic-access-token',
    });
    expect(mocks.getSubscribedApps).toHaveBeenCalledWith({
      wabaId: config.wabaId,
      accessToken: 'synthetic-access-token',
    });
    expect(mocks.supabaseFrom).not.toHaveBeenCalled();
  });

  it('keeps an unreadable encrypted token as a diagnostic response', async () => {
    mocks.decrypt.mockImplementation(() => {
      throw new Error('synthetic decryption failure');
    });

    const response = await GET();

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      live: false,
      checks: { config_exists: true, token_decryptable: false },
    });
    expect(mocks.verifyPhoneNumber).not.toHaveBeenCalled();
    expect(mocks.getSubscribedApps).not.toHaveBeenCalled();
  });

  it('returns Meta check failures in the diagnostic body without failing the request', async () => {
    mocks.verifyPhoneNumber.mockRejectedValue(
      new Error('synthetic phone metadata failure')
    );
    mocks.getSubscribedApps.mockResolvedValue([]);

    const response = await GET();

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      live: false,
      checks: { phone_metadata_ok: false, waba_subscribed_to_app: false },
      errors: [
        'Phone metadata check failed: synthetic phone metadata failure',
        'WABA has no subscribed apps. Re-save the configuration to subscribe.',
      ],
    });
  });

  it('maps PostgreSQL failures to a safe server response', async () => {
    mocks.getRegistrationDiagnostics.mockRejectedValue(
      new Error('synthetic private database detail')
    );

    const response = await GET();

    expect(response.status).toBe(500);
    const body = await response.json();
    expect(body).toEqual({
      error: 'Internal server error',
    });
    expect(mocks.verifyPhoneNumber).not.toHaveBeenCalled();
    expect(JSON.stringify(body)).not.toContain(
      'synthetic private database detail'
    );
  });
});
