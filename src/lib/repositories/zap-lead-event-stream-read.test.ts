import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  transactionQuery: vi.fn(),
  withTransaction: vi.fn(),
}));

vi.mock('../db/postgres-client', () => ({
  withTransaction: mocks.withTransaction,
}));
vi.mock('server-only', () => ({}));

import { createPostgresZapLeadEventStreamReadRepository } from './zap-lead-event-stream-read';

const userId = '00000000-0000-4000-8000-000000000001';
const accountId = '10000000-0000-4000-8000-000000000001';
const cursorId = '20000000-0000-4000-8000-000000000001';
const keyId = 'ak_000000000000000000000000';
const integration = {
  accountId,
  apiBaseUrl: 'https://zap.example.test',
  encryptedRegistration: 'fictional-ciphertext',
};

describe('PostgreSQL Zap Lead event stream read repository', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.transactionQuery.mockImplementation(async (sql: string) => {
      if (sql.includes('FROM public.zap_lead_integrations')) {
        return { rows: [integration] };
      }
      if (sql.includes('FROM public.zap_lead_integration_state')) {
        return { rows: [{ cursor: cursorId }] };
      }
      return { rows: [] };
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

  it('reads only the account integration fields under transaction-local identity', async () => {
    const result = await createPostgresZapLeadEventStreamReadRepository({
      userId,
      accountId,
    }).getIntegration();

    expect(result).toEqual(integration);
    expect(mocks.transactionQuery).toHaveBeenCalledWith(
      expect.stringContaining("set_config('request.jwt.claim.sub', $1, true)"),
      [userId]
    );
    expect(mocks.transactionQuery).toHaveBeenCalledWith(
      expect.stringMatching(/WHERE account_id = \$1::uuid/),
      [accountId]
    );
  });

  it('reads cursor only for the account and validated registration key', async () => {
    const result = await createPostgresZapLeadEventStreamReadRepository({
      userId,
      accountId,
    }).getCursor(keyId);

    expect(result).toBe(cursorId);
    expect(mocks.transactionQuery).toHaveBeenCalledWith(
      expect.stringContaining('integration_key_id = $2::text'),
      [accountId, keyId]
    );
  });

  it('returns null when integration or matching cursor is absent', async () => {
    mocks.transactionQuery.mockImplementation(async (sql: string) => {
      if (sql.includes('FROM public.zap_lead_integrations'))
        return { rows: [] };
      return { rows: [] };
    });

    const repository = createPostgresZapLeadEventStreamReadRepository({
      userId,
      accountId,
    });
    await expect(repository.getIntegration()).resolves.toBeNull();
    await expect(repository.getCursor(keyId)).resolves.toBeNull();
  });

  it('rejects invalid identity before opening a transaction', async () => {
    const repository = createPostgresZapLeadEventStreamReadRepository({
      userId: 'not-a-uuid',
      accountId,
    });

    await expect(repository.getIntegration()).rejects.toThrow();
    expect(mocks.withTransaction).not.toHaveBeenCalled();
  });
});
