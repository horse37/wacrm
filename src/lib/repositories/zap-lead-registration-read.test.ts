import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  transactionQuery: vi.fn(),
  withTransaction: vi.fn(),
}));

vi.mock('../db/postgres-client', () => ({
  withTransaction: mocks.withTransaction,
}));
vi.mock('server-only', () => ({}));

import { createPostgresZapLeadRegistrationReadRepository } from './zap-lead-registration-read';

const userId = '00000000-0000-4000-8000-000000000001';
const accountId = '10000000-0000-4000-8000-000000000001';
const keyId = 'ak_000000000000000000000000';

describe('PostgreSQL Zap Lead registration read repository', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.transactionQuery.mockImplementation(async (sql: string) => {
      if (sql.includes('FROM public.zap_lead_integrations')) {
        return {
          rows: [
            {
              apiBaseUrl: 'https://zap.example.test',
              keyId,
              encryptedRegistration: 'must-not-be-selected',
            },
          ],
        };
      }
      if (sql.includes('FROM public.zap_lead_integration_state')) {
        return {
          rows: [
            {
              lastSuccessAt: '2026-10-21T09:00:00.000Z',
              lastFailureAt: null,
              lastErrorCode: null,
              alertSentAt: null,
            },
          ],
        };
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

  it('reads only published configuration columns for the verified account', async () => {
    const repository = createPostgresZapLeadRegistrationReadRepository({
      userId,
      accountId,
    });

    await expect(repository.getIntegration()).resolves.toEqual({
      apiBaseUrl: 'https://zap.example.test',
      keyId,
    });

    expect(mocks.transactionQuery).toHaveBeenNthCalledWith(
      1,
      "SELECT set_config('request.jwt.claim.sub', $1, true)",
      [userId]
    );
    const [sql, values] = mocks.transactionQuery.mock.calls[1];
    expect(sql).toContain('WHERE account_id = $1::uuid');
    expect(sql).not.toContain('encrypted_registration');
    expect(values).toEqual([accountId]);
  });

  it('scopes heartbeat state to the verified account and active key id', async () => {
    const repository = createPostgresZapLeadRegistrationReadRepository({
      userId,
      accountId,
    });

    await expect(repository.getHeartbeatState(keyId)).resolves.toEqual({
      lastSuccessAt: '2026-10-21T09:00:00.000Z',
      lastFailureAt: null,
      lastErrorCode: null,
      alertSentAt: null,
    });

    expect(mocks.transactionQuery).toHaveBeenNthCalledWith(
      1,
      "SELECT set_config('request.jwt.claim.sub', $1, true)",
      [userId]
    );
    const [sql, values] = mocks.transactionQuery.mock.calls[1];
    expect(sql).toContain('WHERE account_id = $1::uuid');
    expect(sql).toContain('integration_key_id = $2::text');
    expect(values).toEqual([accountId, keyId]);
  });

  it('returns null when configuration or heartbeat state is absent', async () => {
    const repository = createPostgresZapLeadRegistrationReadRepository({
      userId,
      accountId,
    });
    mocks.transactionQuery.mockImplementation(async (sql: string) => {
      if (
        sql.includes('FROM public.zap_lead_integrations') ||
        sql.includes('FROM public.zap_lead_integration_state')
      ) {
        return { rows: [] };
      }
      return { rows: [] };
    });

    await expect(repository.getIntegration()).resolves.toBeNull();
    await expect(repository.getHeartbeatState(keyId)).resolves.toBeNull();
  });

  it('fails closed on invalid account identity without querying PostgreSQL', async () => {
    const repository = createPostgresZapLeadRegistrationReadRepository({
      userId,
      accountId: 'not-a-uuid',
    });

    await expect(repository.getIntegration()).rejects.toMatchObject({
      code: 'db_error',
    });
    expect(mocks.withTransaction).not.toHaveBeenCalled();
  });
});
