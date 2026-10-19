import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  getZapLeadHealthTargets: vi.fn(),
  recordZapLeadHealthSuccess: vi.fn(),
  recordZapLeadHealthFailure: vi.fn(),
  claimZapLeadHeartbeatAlert: vi.fn(),
}));

vi.mock('./credentials', () => ({
  getZapLeadHealthTargets: mocks.getZapLeadHealthTargets,
}));
vi.mock('./events', () => ({
  recordZapLeadHealthSuccess: mocks.recordZapLeadHealthSuccess,
  recordZapLeadHealthFailure: mocks.recordZapLeadHealthFailure,
  claimZapLeadHeartbeatAlert: mocks.claimZapLeadHeartbeatAlert,
}));

import { runZapLeadHeartbeatSweep } from './heartbeat';

describe('Zap Lead heartbeat sweep', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getZapLeadHealthTargets.mockResolvedValue([
      {
        accountId: 'account-healthy',
        keyId: 'ak_000000000000000000000001',
        client: { request: vi.fn().mockResolvedValue({ status: 'ok' }) },
      },
      {
        accountId: 'account-failed',
        keyId: 'ak_000000000000000000000002',
        client: { request: vi.fn().mockRejectedValue(new Error('upstream')) },
      },
      {
        accountId: 'account-invalid',
        keyId: 'ak_000000000000000000000003',
        client: null,
      },
    ]);
    mocks.recordZapLeadHealthSuccess.mockResolvedValue(true);
    mocks.recordZapLeadHealthFailure.mockResolvedValue(true);
    mocks.claimZapLeadHeartbeatAlert
      .mockResolvedValueOnce(false)
      .mockResolvedValueOnce(true)
      .mockResolvedValueOnce(false);
  });

  it('records only health outcomes and invokes the idempotent alert claim per account', async () => {
    const now = new Date('2026-10-13T12:40:00.000Z');

    await expect(runZapLeadHeartbeatSweep(now)).resolves.toEqual({
      checked: 3,
      healthy: 1,
      failed: 2,
      alertsRaised: 1,
    });

    expect(mocks.recordZapLeadHealthSuccess).toHaveBeenCalledWith(
      'account-healthy',
      'ak_000000000000000000000001',
      now
    );
    expect(mocks.recordZapLeadHealthFailure.mock.calls).toEqual(
      expect.arrayContaining([
        [
          'account-failed',
          'ak_000000000000000000000002',
          'health_request_failed',
          now,
        ],
        [
          'account-invalid',
          'ak_000000000000000000000003',
          'invalid_credentials',
          now,
        ],
      ])
    );
    expect(mocks.claimZapLeadHeartbeatAlert).toHaveBeenCalledTimes(3);
    expect(mocks.claimZapLeadHeartbeatAlert).toHaveBeenCalledWith(
      'account-failed',
      'ak_000000000000000000000002',
      now
    );
  });

  it('ignores a health response after the account installs a replacement key', async () => {
    mocks.recordZapLeadHealthSuccess.mockResolvedValueOnce(false);

    await runZapLeadHeartbeatSweep();

    expect(mocks.recordZapLeadHealthFailure).not.toHaveBeenCalledWith(
      'account-healthy',
      'ak_000000000000000000000001',
      'health_request_failed',
      expect.any(Date)
    );
    expect(mocks.claimZapLeadHeartbeatAlert).not.toHaveBeenCalledWith(
      'account-healthy',
      'ak_000000000000000000000001',
      expect.any(Date)
    );
  });
});
