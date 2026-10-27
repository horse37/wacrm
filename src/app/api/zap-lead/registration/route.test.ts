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
vi.mock('@/lib/repositories/zap-lead-registration-read', () => ({
  createPostgresZapLeadRegistrationReadRepository: vi.fn(),
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

import { DELETE, POST } from './route';

describe('Zap Lead registration route', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.NEXT_PUBLIC_SITE_URL = 'https://crm.example.test';
    mocks.requireRole.mockResolvedValue({
      userId: 'user-a',
      accountId: 'account-a',
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

  it('disconnects the Zap Lead registration', async () => {
    const deleteResponse = await DELETE();
    expect(deleteResponse.status).toBe(204);
    expect(mocks.removeZapLeadCredentials).toHaveBeenCalledOnce();
  });
});
