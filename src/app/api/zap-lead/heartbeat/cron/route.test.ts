import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ runZapLeadHeartbeatSweep: vi.fn() }));

vi.mock('@/lib/zap-lead/heartbeat', () => ({
  runZapLeadHeartbeatSweep: mocks.runZapLeadHeartbeatSweep,
}));

import { GET } from './route';

describe('Zap Lead heartbeat cron route', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.AUTOMATION_CRON_SECRET = 'local-cron-secret';
    mocks.runZapLeadHeartbeatSweep.mockResolvedValue({
      checked: 2,
      healthy: 1,
      failed: 1,
      alertsRaised: 1,
    });
  });

  it('rejects requests without the cron secret', async () => {
    const response = await GET(
      new Request('https://agency.example.test/api/zap-lead/heartbeat/cron')
    );

    expect(response.status).toBe(401);
    expect(mocks.runZapLeadHeartbeatSweep).not.toHaveBeenCalled();
  });

  it('runs the sweep only for a valid cron secret', async () => {
    const response = await GET(
      new Request('https://agency.example.test/api/zap-lead/heartbeat/cron', {
        headers: { 'x-cron-secret': 'local-cron-secret' },
      })
    );

    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(await response.json()).toEqual({
      checked: 2,
      healthy: 1,
      failed: 1,
      alertsRaised: 1,
    });
    expect(mocks.runZapLeadHeartbeatSweep).toHaveBeenCalledOnce();
  });

  it('fails closed when the scheduler secret is not configured', async () => {
    delete process.env.AUTOMATION_CRON_SECRET;

    const response = await GET(
      new Request('https://agency.example.test/api/zap-lead/heartbeat/cron')
    );

    expect(response.status).toBe(503);
    expect(mocks.runZapLeadHeartbeatSweep).not.toHaveBeenCalled();
  });
});
