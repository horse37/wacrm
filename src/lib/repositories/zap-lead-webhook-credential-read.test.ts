import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  transactionQuery: vi.fn(),
  withTransaction: vi.fn(),
}));

vi.mock('../db/postgres-client', () => ({
  withTransaction: mocks.withTransaction,
}));
vi.mock('server-only', () => ({}));

import { lookupZapLeadWebhookCredential } from './zap-lead-webhook-credential-read';

const keyId = 'ak_000000000000000000000000';
const accountId = '10000000-0000-4000-8000-000000000001';
const encryptedRegistration = 'synthetic-ciphertext';

describe('PostgreSQL Zap Lead webhook credential repository', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.transactionQuery.mockImplementation(async (sql: string) => {
      if (sql.includes('set_config')) return { rows: [] };
      return { rows: [{ accountId, encryptedRegistration }] };
    });
    mocks.withTransaction.mockImplementation(async (operation) => {
      try {
        return {
          ok: true,
          data: await operation({ query: mocks.transactionQuery }),
        };
      } catch (error) {
        return { ok: false, error };
      }
    });
  });

  it('scopes a parameterized column-only lookup to transaction-local keyId', async () => {
    await expect(lookupZapLeadWebhookCredential(keyId)).resolves.toEqual({
      accountId,
      encryptedRegistration,
    });

    expect(mocks.withTransaction).toHaveBeenCalledOnce();
    expect(mocks.transactionQuery).toHaveBeenNthCalledWith(
      1,
      "SELECT pg_catalog.set_config('app.wacrm_zap_lead_webhook_key_id', $1, true)",
      [keyId]
    );
    const [sql, values] = mocks.transactionQuery.mock.calls[1];
    expect(sql).toContain('account_id AS "accountId"');
    expect(sql).toContain('encrypted_registration AS "encryptedRegistration"');
    expect(sql).toContain('FROM public.zap_lead_integrations');
    expect(sql).toContain('WHERE key_id = $1::text');
    expect(sql).toContain('LIMIT 2');
    expect(sql).not.toContain('api_base_url');
    expect(values).toEqual([keyId]);
  });

  it('returns null when no credential matches', async () => {
    mocks.transactionQuery.mockImplementation(async (sql: string) =>
      sql.includes('set_config') ? { rows: [] } : { rows: [] }
    );

    await expect(lookupZapLeadWebhookCredential(keyId)).resolves.toBeNull();
    expect(mocks.transactionQuery).toHaveBeenCalledTimes(2);
  });

  it('rejects malformed keys without opening a database transaction', async () => {
    await expect(lookupZapLeadWebhookCredential('invalid')).resolves.toBeNull();
    expect(mocks.withTransaction).not.toHaveBeenCalled();
    expect(mocks.transactionQuery).not.toHaveBeenCalled();
  });

  it('maps transaction errors to a generic database error', async () => {
    mocks.transactionQuery.mockRejectedValue(new Error('database detail'));

    await expect(lookupZapLeadWebhookCredential(keyId)).rejects.toMatchObject({
      code: 'db_error',
    });
  });

  it.each([
    { accountId: 'not-a-uuid', encryptedRegistration },
    { accountId, encryptedRegistration: null },
  ])('fails closed for malformed stored rows', async (row) => {
    mocks.transactionQuery.mockImplementation(async (sql: string) =>
      sql.includes('set_config') ? { rows: [] } : { rows: [row] }
    );

    await expect(lookupZapLeadWebhookCredential(keyId)).rejects.toMatchObject({
      code: 'db_error',
    });
  });

  it('fails closed if PostgreSQL returns duplicate credentials', async () => {
    mocks.transactionQuery.mockImplementation(async (sql: string) =>
      sql.includes('set_config')
        ? { rows: [] }
        : {
            rows: [
              { accountId, encryptedRegistration },
              { accountId, encryptedRegistration },
            ],
          }
    );

    await expect(lookupZapLeadWebhookCredential(keyId)).rejects.toMatchObject({
      code: 'db_error',
    });
  });
});
