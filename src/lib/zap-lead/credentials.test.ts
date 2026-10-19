import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createRegistrationCode,
  type ZapLeadRegistration,
} from './registration';

const mocks = vi.hoisted(() => ({
  requireRole: vi.fn(),
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

  it('loads the live cursor from the authenticated account state', async () => {
    const makeQuery = (data: unknown) => {
      const query = {
        eq: vi.fn(),
        maybeSingle: vi.fn().mockResolvedValue({ data, error: null }),
        select: vi.fn(),
      };
      query.eq.mockReturnValue(query);
      query.select.mockReturnValue(query);
      return query;
    };
    const integrationQuery = makeQuery({
      account_id: 'account-b',
      api_base_url: 'https://zap.example.test',
      encrypted_registration: `ciphertext:${Buffer.from(
        JSON.stringify(registration),
        'utf8'
      ).toString('base64')}`,
    });
    const stateQuery = makeQuery({
      last_sse_cursor_id: '18fae01a-a5b8-4a7e-95af-453810e49dc9',
    });
    const from = vi.fn((table: string) =>
      table === 'zap_lead_integrations' ? integrationQuery : stateQuery
    );
    mocks.requireRole.mockResolvedValue({
      accountId: 'account-b',
      supabase: { from },
    });

    await expect(
      getZapLeadEventStreamTargetForCurrentAccount()
    ).resolves.toMatchObject({
      accountId: 'account-b',
      keyId: registration.keyId,
      cursor: '18fae01a-a5b8-4a7e-95af-453810e49dc9',
    });
    expect(integrationQuery.eq).toHaveBeenCalledWith('account_id', 'account-b');
    expect(stateQuery.eq).toHaveBeenCalledWith('account_id', 'account-b');
    expect(stateQuery.eq).toHaveBeenCalledWith(
      'integration_key_id',
      registration.keyId
    );
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
    const query = {
      eq: vi.fn(),
      maybeSingle: vi.fn().mockResolvedValue({
        data: {
          account_id: 'account-c',
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
    mocks.zapLeadAdminClient.mockReturnValue({ from });

    await expect(
      getZapLeadWebhookCredential(registration.keyId)
    ).resolves.toEqual({ accountId: 'account-c', registration });
    expect(from).toHaveBeenCalledWith('zap_lead_integrations');
    expect(query.eq).toHaveBeenCalledWith('key_id', registration.keyId);
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
