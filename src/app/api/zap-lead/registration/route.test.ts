import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  requireRole: vi.fn(),
  saveZapLeadCredentials: vi.fn(),
  removeZapLeadCredentials: vi.fn(),
  checkRateLimit: vi.fn(() => ({ success: true })),
}));

vi.mock('@/lib/auth/account', () => ({
  requireRole: mocks.requireRole,
  toErrorResponse: vi.fn(() =>
    Response.json({ error: 'Internal server error' }, { status: 500 })
  ),
}));
vi.mock('@/lib/zap-lead/credentials', () => ({
  saveZapLeadCredentials: mocks.saveZapLeadCredentials,
  removeZapLeadCredentials: mocks.removeZapLeadCredentials,
}));
vi.mock('@/lib/rate-limit', () => ({
  checkRateLimit: mocks.checkRateLimit,
  rateLimitResponse: vi.fn(() =>
    Response.json({ error: 'rate limited' }, { status: 429 })
  ),
  RATE_LIMITS: { adminAction: {} },
}));

import { DELETE, GET, POST } from './route';

function singleResult(data: unknown) {
  const query = {
    eq: vi.fn(),
    maybeSingle: vi.fn().mockResolvedValue({ data, error: null }),
  };
  query.eq.mockReturnValue(query);
  return {
    select: vi.fn(() => query),
  };
}

describe('Zap Lead registration route', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.NEXT_PUBLIC_SITE_URL = 'https://crm.example.test';
    mocks.requireRole.mockResolvedValue({
      userId: 'user-a',
      accountId: 'account-a',
      supabase: {
        from: vi.fn(() => ({
          select: vi.fn(() => ({
            eq: vi.fn(() => ({
              maybeSingle: vi.fn().mockResolvedValue({
                data: null,
                error: null,
              }),
            })),
          })),
        })),
      },
    });
  });

  it('generates a code, stores it for the current admin account, and returns it once', async () => {
    const response = await POST(
      new Request('https://crm.example.test/api/zap-lead/registration', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ apiBaseUrl: 'https://zap.example.test' }),
      })
    );
    const body = await response.json();

    expect(response.status).toBe(201);
    expect(body.webhookUrl).toBe(
      'https://crm.example.test/api/zap-lead/webhook'
    );
    expect(body.registrationCode).toMatch(/^zap-lead-agency:v1:/);
    expect(Object.keys(body).sort()).toEqual([
      'registrationCode',
      'webhookUrl',
    ]);
    expect(mocks.saveZapLeadCredentials).toHaveBeenCalledWith(
      body.registrationCode,
      'https://zap.example.test'
    );
  });

  it('rejects non-HTTPS or non-origin Zap Lead URLs before saving credentials', async () => {
    const response = await POST(
      new Request('https://crm.example.test/api/zap-lead/registration', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ apiBaseUrl: 'https://zap.example.test/path' }),
      })
    );

    expect(response.status).toBe(400);
    expect(mocks.saveZapLeadCredentials).not.toHaveBeenCalled();
  });

  it('returns configuration metadata without secrets and can disconnect', async () => {
    const getResponse = await GET();
    const status = await getResponse.json();
    expect(status).toEqual({
      configured: false,
      apiBaseUrl: null,
      generation: null,
      heartbeat: {
        lastSuccessAt: null,
        lastFailureAt: null,
        lastErrorCode: null,
        alertSentAt: null,
      },
    });

    const deleteResponse = await DELETE();
    expect(deleteResponse.status).toBe(204);
    expect(mocks.removeZapLeadCredentials).toHaveBeenCalledOnce();
  });

  it('returns only technical heartbeat state for the current account', async () => {
    const from = vi.fn((table: string) =>
      singleResult(
        table === 'zap_lead_integrations'
          ? {
              api_base_url: 'https://zap.example.test',
              key_id: 'ak_000000000000000000000000',
            }
          : {
              last_success_at: '2026-10-14T09:00:00.000Z',
              last_failure_at: '2026-10-14T09:10:00.000Z',
              last_error_code: 'health_request_failed',
              alert_sent_at: '2026-10-14T09:10:00.000Z',
            }
      )
    );
    mocks.requireRole.mockResolvedValueOnce({
      userId: 'user-a',
      accountId: 'account-a',
      supabase: { from },
    });

    const response = await GET();

    expect(await response.json()).toEqual({
      configured: true,
      apiBaseUrl: 'https://zap.example.test',
      generation: 'ak_000000000000000000000000',
      heartbeat: {
        lastSuccessAt: '2026-10-14T09:00:00.000Z',
        lastFailureAt: '2026-10-14T09:10:00.000Z',
        lastErrorCode: 'health_request_failed',
        alertSentAt: '2026-10-14T09:10:00.000Z',
      },
    });
    expect(from).toHaveBeenNthCalledWith(1, 'zap_lead_integrations');
    expect(from).toHaveBeenNthCalledWith(2, 'zap_lead_integration_state');
  });
});
