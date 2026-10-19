import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ForbiddenError, UnauthorizedError } from '@/lib/auth/account';
import { GET } from './route';

const mocks = vi.hoisted(() => ({ getMatrix: vi.fn() }));

vi.mock('@/lib/zap-lead/analysis-matrix', () => ({
  getZapLeadAnalysisMatrixForCurrentAccount: mocks.getMatrix,
}));

describe('Zap Lead analysis matrix route', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getMatrix.mockResolvedValue({
      status: 'ready',
      completedAt: '2026-10-14T12:00:00.000Z',
      totalAnalyzed: 2,
      matrix: [],
    });
  });

  it('returns the current-account matrix without caching', async () => {
    const response = await GET(
      new Request('http://localhost/api/zap-lead/analysis-matrix?days=7')
    );
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(await response.json()).toMatchObject({
      status: 'ready',
      totalAnalyzed: 2,
    });
    expect(mocks.getMatrix).toHaveBeenCalledWith(7, expect.any(Date), {});
  });

  it('accepts seller and campaign filters and forwards them', async () => {
    const response = await GET(
      new Request(
        'http://localhost/api/zap-lead/analysis-matrix?days=7&sellerId=A1111111-1111-4111-8111-111111111111&campaignCode=LANCTO-TESTE'
      )
    );

    expect(response.status).toBe(200);
    expect(mocks.getMatrix).toHaveBeenCalledWith(7, expect.any(Date), {
      sellerId: 'a1111111-1111-4111-8111-111111111111',
      campaignCode: 'LANCTO-TESTE',
    });
  });

  it('rejects invalid or duplicate query parameters', async () => {
    for (const url of [
      'http://localhost/api/zap-lead/analysis-matrix?days=14',
      'http://localhost/api/zap-lead/analysis-matrix?days=7&days=30',
      'http://localhost/api/zap-lead/analysis-matrix?days=7&sellerId=abc',
    ]) {
      const response = await GET(new Request(url));
      expect(response.status).toBe(400);
    }
    expect(mocks.getMatrix).not.toHaveBeenCalled();
  });

  it('reports missing installation and preserves account authorization status', async () => {
    mocks.getMatrix.mockResolvedValueOnce(null);
    const missing = await GET(
      new Request('http://localhost/api/zap-lead/analysis-matrix')
    );
    expect(missing.status).toBe(404);
    expect(await missing.json()).toEqual({ error: 'zap_lead_not_configured' });

    mocks.getMatrix.mockRejectedValueOnce(new UnauthorizedError());
    expect(
      (await GET(new Request('http://localhost/api/zap-lead/analysis-matrix')))
        .status
    ).toBe(401);
    mocks.getMatrix.mockRejectedValueOnce(new ForbiddenError());
    expect(
      (await GET(new Request('http://localhost/api/zap-lead/analysis-matrix')))
        .status
    ).toBe(403);
  });

  it('returns a generic upstream failure', async () => {
    mocks.getMatrix.mockRejectedValue(new Error('secret upstream detail'));
    const response = await GET(
      new Request('http://localhost/api/zap-lead/analysis-matrix')
    );
    expect(response.status).toBe(502);
    expect(await response.json()).toEqual({ error: 'zap_lead_unavailable' });
  });
});
