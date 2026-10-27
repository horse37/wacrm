import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  query: vi.fn(),
  withTransaction: vi.fn(),
}));

vi.mock('../db/postgres-client', () => ({
  withTransaction: mocks.withTransaction,
}));

vi.mock('server-only', () => ({}));

import { AppError } from '../db/errors';
import {
  claimZapLeadHeartbeatAlert,
  recordZapLeadHealthFailure,
  recordZapLeadHealthSuccess,
} from './zap-lead-heartbeat';

const accountId = '10000000-0000-4000-8000-000000000001';
const keyId = 'ak_aaaaaaaaaaaaaaaaaaaaaaaa';
const checkedAt = new Date('2026-10-23T03:00:00.000Z');

describe('Zap Lead heartbeat PostgreSQL repository', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.query.mockResolvedValue({
      rows: [{ result: true }],
      rowCount: 1,
    });
    mocks.withTransaction.mockImplementation(async (operation) => ({
      ok: true,
      data: await operation({ query: mocks.query }),
    }));
  });

  it('calls all three functions with bound account, key, code, and timestamp values', async () => {
    await expect(
      recordZapLeadHealthSuccess(accountId, keyId, checkedAt)
    ).resolves.toBe(true);
    await expect(
      recordZapLeadHealthFailure(
        accountId,
        keyId,
        'health_request_failed',
        checkedAt
      )
    ).resolves.toBe(true);
    await expect(
      claimZapLeadHeartbeatAlert(accountId, keyId, checkedAt)
    ).resolves.toBe(true);

    expect(mocks.withTransaction).toHaveBeenCalledTimes(3);
    expect(mocks.query).toHaveBeenNthCalledWith(
      1,
      expect.stringMatching(
        /SELECT public\.record_zap_lead_health_success\(\$1::uuid, \$2::text, \$3::timestamptz\) AS result/
      ),
      [accountId, keyId, checkedAt.toISOString()]
    );
    expect(mocks.query).toHaveBeenNthCalledWith(
      2,
      expect.stringMatching(
        /SELECT public\.record_zap_lead_health_failure\(\$1::uuid, \$2::text, \$3::text, \$4::timestamptz\) AS result/
      ),
      [accountId, keyId, 'health_request_failed', checkedAt.toISOString()]
    );
    expect(mocks.query).toHaveBeenNthCalledWith(
      3,
      expect.stringMatching(
        /SELECT public\.claim_zap_lead_heartbeat_alert\(\$1::uuid, \$2::text, \$3::timestamptz\) AS result/
      ),
      [accountId, keyId, checkedAt.toISOString()]
    );
  });

  it('preserves false for an obsolete key generation or an unclaimed alert', async () => {
    mocks.query.mockResolvedValue({ rows: [{ result: false }], rowCount: 1 });

    await expect(
      recordZapLeadHealthSuccess(accountId, keyId, checkedAt)
    ).resolves.toBe(false);
    await expect(
      recordZapLeadHealthFailure(
        accountId,
        keyId,
        'invalid_credentials',
        checkedAt
      )
    ).resolves.toBe(false);
    await expect(
      claimZapLeadHeartbeatAlert(accountId, keyId, checkedAt)
    ).resolves.toBe(false);
  });

  it.each([
    [
      'health success',
      () => recordZapLeadHealthSuccess(accountId, keyId, checkedAt),
      'Could not persist Zap Lead health success',
    ],
    [
      'health failure',
      () =>
        recordZapLeadHealthFailure(
          accountId,
          keyId,
          'health_request_failed',
          checkedAt
        ),
      'Could not persist Zap Lead health failure',
    ],
    [
      'heartbeat alert',
      () => claimZapLeadHeartbeatAlert(accountId, keyId, checkedAt),
      'Could not claim Zap Lead heartbeat alert',
    ],
  ])('masks PostgreSQL failures for %s', async (_name, call, message) => {
    mocks.withTransaction.mockResolvedValueOnce({
      ok: false,
      error: new AppError('db_error'),
    });

    await expect(call()).rejects.toThrow(message);
  });

  it('rejects missing or non-boolean function results generically', async () => {
    mocks.query.mockResolvedValueOnce({ rows: [], rowCount: 0 });
    await expect(
      recordZapLeadHealthSuccess(accountId, keyId, checkedAt)
    ).rejects.toThrow('Could not persist Zap Lead health success');

    mocks.query.mockResolvedValueOnce({
      rows: [{ result: 'true' }],
      rowCount: 1,
    });
    await expect(
      recordZapLeadHealthFailure(
        accountId,
        keyId,
        'health_request_failed',
        checkedAt
      )
    ).rejects.toThrow('Could not persist Zap Lead health failure');

    mocks.query.mockResolvedValueOnce({
      rows: [{ result: null }],
      rowCount: 1,
    });
    await expect(
      claimZapLeadHeartbeatAlert(accountId, keyId, checkedAt)
    ).rejects.toThrow('Could not claim Zap Lead heartbeat alert');
  });
});
