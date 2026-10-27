import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createRegistrationCode,
  type ZapLeadRegistration,
} from './registration';

const mocks = vi.hoisted(() => ({
  requireRole: vi.fn(),
  eventStreamRepository: vi.fn(),
  eventStreamGetIntegration: vi.fn(),
  eventStreamGetCursor: vi.fn(),
  webhookCredentialLookup: vi.fn(),
  encrypt: vi.fn(
    (value: string) =>
      `ciphertext:${Buffer.from(value, 'utf8').toString('base64')}`
  ),
  decrypt: vi.fn((value: string) =>
    Buffer.from(value.replace(/^ciphertext:/, ''), 'base64').toString('utf8')
  ),
  createZapLeadClient: vi.fn((options: unknown) => ({ options })),
  zapLeadAdminClient: vi.fn(),
}));

vi.mock('@/lib/auth/account', () => ({ requireRole: mocks.requireRole }));
vi.mock('@/lib/repositories/zap-lead-event-stream-read', () => ({
  createPostgresZapLeadEventStreamReadRepository: mocks.eventStreamRepository,
}));
vi.mock('../repositories/zap-lead-webhook-credential-read', () => ({
  lookupZapLeadWebhookCredential: mocks.webhookCredentialLookup,
}));
vi.mock('@/lib/whatsapp/encryption', () => ({
  encrypt: mocks.encrypt,
  decrypt: mocks.decrypt,
}));
vi.mock('./client', () => ({
  createZapLeadClient: mocks.createZapLeadClient,
}));
vi.mock('./admin-client', () => ({
  zapLeadAdminClient: mocks.zapLeadAdminClient,
}));

import {
  getZapLeadClientForCurrentAccount,
  getZapLeadEventStreamTargetForCurrentAccount,
  getZapLeadHealthTargets,
  getZapLeadReadClientForCurrentAccount,
  getZapLeadWriteClientForCurrentAccount,
  getZapLeadWebhookCredential,
  saveZapLeadCredentials,
} from './credentials';

const registration: ZapLeadRegistration = {
  version: 1,
  keyId: 'ak_000000000000000000000000',
  secret: 'test_secret_for_local_fixture_0001',
  webhookUrl: 'https://agency.example.test/api/zap-lead/webhook',
  events: ['lead.created'],
};

describe('Zap Lead credential storage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('stores only encrypted registration data under the authenticated account', async () => {
    const upsert = vi.fn().mockResolvedValue({ error: null });
    const from = vi.fn(() => ({ upsert }));
    const account = {
      accountId: 'account-a',
      supabase: { from },
    };
    mocks.requireRole.mockResolvedValue(account);
    const code = createRegistrationCode(registration);

    await saveZapLeadCredentials(code, 'https://zap.example.test');

    expect(mocks.requireRole).toHaveBeenCalledWith('admin');
    expect(from).toHaveBeenCalledWith('zap_lead_integrations');
    expect(upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        account_id: 'account-a',
        key_id: registration.keyId,
        api_base_url: 'https://zap.example.test',
        encrypted_registration: expect.stringMatching(/^ciphertext:/),
      }),
      { onConflict: 'account_id' }
    );
    expect(JSON.stringify(upsert.mock.calls[0][0])).not.toContain(
      registration.secret
    );
    expect(upsert.mock.calls[0][0].created_at).toBe(
      upsert.mock.calls[0][0].updated_at
    );
    expect(Date.parse(upsert.mock.calls[0][0].created_at)).not.toBeNaN();
  });

  it('loads credentials only for the authenticated account before creating a client', async () => {
    const query = {
      eq: vi.fn(),
      maybeSingle: vi.fn().mockResolvedValue({
        data: {
          api_base_url: 'https://zap.example.test',
          encrypted_registration: `ciphertext:${Buffer.from(
            JSON.stringify(registration),
            'utf8'
          ).toString('base64')}`,
        },
        error: null,
      }),
    };
    query.eq.mockReturnValue(query);
    const select = vi.fn(() => query);
    const from = vi.fn(() => ({ select }));
    mocks.requireRole.mockResolvedValue({
      accountId: 'account-b',
      supabase: { from },
    });

    await getZapLeadClientForCurrentAccount();

    expect(query.eq).toHaveBeenCalledWith('account_id', 'account-b');
    expect(mocks.createZapLeadClient).toHaveBeenCalledWith({
      baseUrl: 'https://zap.example.test',
      keyId: registration.keyId,
      secret: registration.secret,
    });
  });

  it('limits lead creation credentials to admins and owners', async () => {
    const query = {
      eq: vi.fn(),
      maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
    };
    query.eq.mockReturnValue(query);
    const select = vi.fn(() => query);
    const from = vi.fn(() => ({ select }));
    mocks.requireRole.mockResolvedValue({
      accountId: 'account-admin',
      supabase: { from },
    });

    await expect(getZapLeadWriteClientForCurrentAccount()).resolves.toBeNull();

    expect(mocks.requireRole).toHaveBeenCalledWith('admin');
    expect(from).toHaveBeenCalledWith('zap_lead_integrations');
    expect(query.eq).toHaveBeenCalledWith('account_id', 'account-admin');
  });

  it('loads the event stream target and cursor through the PostgreSQL repository', async () => {
    const accountId = '10000000-0000-4000-8000-000000000001';
    const userId = '00000000-0000-4000-8000-000000000001';
    const cursor = '18fae01a-a5b8-4a7e-95af-453810e49dc9';
    const from = vi.fn();
    const getIntegration = vi.fn().mockResolvedValue({
      accountId,
      apiBaseUrl: 'https://zap.example.test',
      encryptedRegistration: `ciphertext:${Buffer.from(
        JSON.stringify(registration),
        'utf8'
      ).toString('base64')}`,
    });
    const getCursor = vi.fn().mockResolvedValue(cursor);
    mocks.requireRole.mockResolvedValue({
      accountId,
      userId,
      supabase: { from },
    });
    mocks.eventStreamRepository.mockReturnValue({ getIntegration, getCursor });

    await expect(
      getZapLeadEventStreamTargetForCurrentAccount()
    ).resolves.toMatchObject({
      accountId,
      keyId: registration.keyId,
      cursor,
    });
    expect(mocks.eventStreamRepository).toHaveBeenCalledWith({
      userId,
      accountId,
    });
    expect(getCursor).toHaveBeenCalledWith(registration.keyId);
    expect(from).not.toHaveBeenCalled();
  });
  it('returns null without reading a cursor when integration is absent', async () => {
    const accountId = '10000000-0000-4000-8000-000000000001';
    const userId = '00000000-0000-4000-8000-000000000001';
    const from = vi.fn();
    const getIntegration = vi.fn().mockResolvedValue(null);
    const getCursor = vi.fn();
    mocks.requireRole.mockResolvedValue({
      accountId,
      userId,
      supabase: { from },
    });
    mocks.eventStreamRepository.mockReturnValue({ getIntegration, getCursor });

    await expect(
      getZapLeadEventStreamTargetForCurrentAccount()
    ).resolves.toBeNull();
    expect(getCursor).not.toHaveBeenCalled();
    expect(from).not.toHaveBeenCalled();
  });

  it('hides cursor repository errors behind the existing generic message', async () => {
    const accountId = '10000000-0000-4000-8000-000000000001';
    const userId = '00000000-0000-4000-8000-000000000001';
    const getIntegration = vi.fn().mockResolvedValue({
      accountId,
      apiBaseUrl: 'https://zap.example.test',
      encryptedRegistration: `ciphertext:${Buffer.from(
        JSON.stringify(registration),
        'utf8'
      ).toString('base64')}`,
    });
    const getCursor = vi.fn().mockRejectedValue(new Error('database detail'));
    mocks.requireRole.mockResolvedValue({ accountId, userId });
    mocks.eventStreamRepository.mockReturnValue({ getIntegration, getCursor });

    await expect(
      getZapLeadEventStreamTargetForCurrentAccount()
    ).rejects.toThrow('Could not load Zap Lead event stream cursor');
  });

  it('loads heartbeat targets with their current key generation', async () => {
    const query = {
      select: vi.fn(),
    };
    query.select.mockResolvedValue({
      data: [
        {
          account_id: 'account-c',
          key_id: registration.keyId,
          api_base_url: 'https://zap.example.test',
          encrypted_registration: `ciphertext:${Buffer.from(
            JSON.stringify(registration),
            'utf8'
          ).toString('base64')}`,
        },
      ],
      error: null,
    });
    const from = vi.fn(() => query);
    mocks.zapLeadAdminClient.mockReturnValue({ from });

    await expect(getZapLeadHealthTargets()).resolves.toMatchObject([
      { accountId: 'account-c', keyId: registration.keyId, client: {} },
    ]);
    expect(from).toHaveBeenCalledWith('zap_lead_integrations');
    expect(query.select).toHaveBeenCalledWith(
      'account_id, key_id, api_base_url, encrypted_registration'
    );
  });

  it('looks up incoming webhook credentials by key id and returns their account scope', async () => {
    mocks.webhookCredentialLookup.mockResolvedValue({
      accountId: 'account-c',
      encryptedRegistration: `ciphertext:${Buffer.from(
        JSON.stringify(registration),
        'utf8'
      ).toString('base64')}`,
    });

    await expect(
      getZapLeadWebhookCredential(registration.keyId)
    ).resolves.toEqual({ accountId: 'account-c', registration });
    expect(mocks.webhookCredentialLookup).toHaveBeenCalledWith(
      registration.keyId
    );
    expect(mocks.zapLeadAdminClient).not.toHaveBeenCalled();
  });

  it('rejects malformed webhook key ids before PostgreSQL lookup', async () => {
    await expect(getZapLeadWebhookCredential('invalid')).resolves.toBeNull();
    expect(mocks.webhookCredentialLookup).not.toHaveBeenCalled();
  });

  it('returns null when decrypted registration key does not match lookup key', async () => {
    const otherRegistration = {
      ...registration,
      keyId: 'ak_111111111111111111111111',
    };
    mocks.webhookCredentialLookup.mockResolvedValue({
      accountId: 'account-c',
      encryptedRegistration: `ciphertext:${Buffer.from(
        JSON.stringify(otherRegistration),
        'utf8'
      ).toString('base64')}`,
    });

    await expect(
      getZapLeadWebhookCredential(registration.keyId)
    ).resolves.toBeNull();
  });
});

describe('Zap Lead read-only access', () => {
  it('loads credentials for the authenticated account with a GET-only client', async () => {
    const query = {
      eq: vi.fn(),
      maybeSingle: vi.fn().mockResolvedValue({
        data: {
          api_base_url: 'https://zap.example.test',
          encrypted_registration: `ciphertext:${Buffer.from(
            JSON.stringify(registration),
            'utf8'
          ).toString('base64')}`,
        },
        error: null,
      }),
    };
    query.eq.mockReturnValue(query);
    const select = vi.fn(() => query);
    const from = vi.fn(() => ({ select }));
    mocks.requireRole.mockResolvedValue({
      accountId: 'account-viewer',
      supabase: { from },
    });

    const client = await getZapLeadReadClientForCurrentAccount();

    expect(mocks.requireRole).toHaveBeenCalledWith('viewer');
    expect(query.eq).toHaveBeenCalledWith('account_id', 'account-viewer');
    expect(client).toEqual({ get: expect.any(Function) });
  });
});
