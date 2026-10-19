import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ForbiddenError, UnauthorizedError } from '@/lib/auth/account';
import { GET } from './route';

const mocks = vi.hoisted(() => ({
  getIndicators: vi.fn(),
}));

vi.mock('@/lib/zap-lead/indicators', () => ({
  getZapLeadIndicatorsForCurrentAccount: mocks.getIndicators,
}));

const result = {
  period: {
    from: '2026-10-08T00:00:00.000Z',
    to: '2026-10-14T23:59:59.999Z',
  },
  items: [{ key: 'leads_created', value: 12, unit: 'count' }],
};

describe('Zap Lead indicator route', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getIndicators.mockResolvedValue(result);
  });

  it('returns current-account indicators without caching the response', async () => {
    const response = await GET(
      new Request('http://localhost/api/zap-lead/indicators?days=7')
    );

    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(await response.json()).toEqual(result);
    expect(mocks.getIndicators).toHaveBeenCalledWith(7, expect.any(Date), {});
  });

  it('accepts seller and campaign filters and forwards them', async () => {
    const response = await GET(
      new Request(
        'http://localhost/api/zap-lead/indicators?days=7&sellerId=A1111111-1111-4111-8111-111111111111&campaignCode=LANCTO-TESTE'
      )
    );

    expect(response.status).toBe(200);
    expect(mocks.getIndicators).toHaveBeenCalledWith(7, expect.any(Date), {
      sellerId: 'a1111111-1111-4111-8111-111111111111',
      campaignCode: 'LANCTO-TESTE',
    });
  });

  it('rejects unsupported periods before requesting indicators', async () => {
    for (const url of [
      'http://localhost/api/zap-lead/indicators?days=14',
      'http://localhost/api/zap-lead/indicators?days=7&days=30',
      'http://localhost/api/zap-lead/indicators?days=7&sellerId=invalid',
      'http://localhost/api/zap-lead/indicators?days=7&sellerId=11111111-1111-4111-8111-111111111111&sellerId=11111111-1111-4111-8111-111111111111',
      'http://localhost/api/zap-lead/indicators?campaignCode=',
    ]) {
      const response = await GET(new Request(url));
      expect(response.status).toBe(400);
    }
    expect(mocks.getIndicators).not.toHaveBeenCalled();
  });

  it('reports when the current account has no registered installation', async () => {
    mocks.getIndicators.mockResolvedValue(null);

    const response = await GET(
      new Request('http://localhost/api/zap-lead/indicators')
    );

    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: 'zap_lead_not_configured' });
  });

  it('preserves unauthorized and forbidden account responses', async () => {
    mocks.getIndicators.mockRejectedValueOnce(new UnauthorizedError());
    const unauthorized = await GET(
      new Request('http://localhost/api/zap-lead/indicators')
    );
    expect(unauthorized.status).toBe(401);

    mocks.getIndicators.mockRejectedValueOnce(new ForbiddenError());
    const forbidden = await GET(
      new Request('http://localhost/api/zap-lead/indicators')
    );
    expect(forbidden.status).toBe(403);
  });

  it('does not expose upstream errors', async () => {
    mocks.getIndicators.mockRejectedValue(new Error('secret upstream detail'));

    const response = await GET(
      new Request('http://localhost/api/zap-lead/indicators')
    );

    expect(response.status).toBe(502);
    expect(await response.json()).toEqual({ error: 'zap_lead_unavailable' });
  });
});
