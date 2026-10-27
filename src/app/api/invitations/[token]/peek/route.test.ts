import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  checkRateLimit: vi.fn(),
  rateLimitResponse: vi.fn(),
  hashInviteToken: vi.fn(),
  createPreviewRepository: vi.fn(),
  peekByTokenHash: vi.fn(),
  createClient: vi.fn(),
}));

vi.mock('@/lib/rate-limit', () => ({
  checkRateLimit: mocks.checkRateLimit,
  rateLimitResponse: mocks.rateLimitResponse,
  RATE_LIMITS: { invitationPeek: { limit: 30, windowMs: 60_000 } },
}));
vi.mock('@/lib/auth/invitations', () => ({
  hashInviteToken: mocks.hashInviteToken,
}));
vi.mock('@/lib/repositories/invitation-preview', () => ({
  createPostgresInvitationPreviewRepository: mocks.createPreviewRepository,
}));
vi.mock('@/lib/supabase/server', () => ({ createClient: mocks.createClient }));

import { GET } from './route';

const token = 'synthetic-invitation-token';
const tokenHash = 'a'.repeat(64);
const activePreview = {
  ok: true,
  account_name: 'Synthetic Account',
  role: 'agent',
  expires_at: '2026-10-26T12:00:00.000Z',
};

function previewRequest(
  request: Request = new Request(
    `https://wacrm.example.test/api/invitations/${token}/peek`,
    { headers: { 'x-forwarded-for': '203.0.113.10, 10.0.0.1' } }
  ),
  requestedToken = token
) {
  return GET(request, { params: Promise.resolve({ token: requestedToken }) });
}

describe('GET /api/invitations/[token]/peek', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.checkRateLimit.mockReturnValue({ success: true });
    mocks.rateLimitResponse.mockImplementation(() =>
      Response.json({ ok: false, reason: 'rate_limited' }, { status: 429 })
    );
    mocks.hashInviteToken.mockReturnValue(tokenHash);
    mocks.createPreviewRepository.mockReturnValue({
      peekByTokenHash: mocks.peekByTokenHash,
    });
    mocks.peekByTokenHash.mockResolvedValue(activePreview);
    mocks.createClient.mockResolvedValue({
      rpc: vi.fn().mockResolvedValue({ data: activePreview, error: null }),
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('rate-limits by the original client IP, hashes the token, then reads PostgreSQL', async () => {
    const order: string[] = [];
    mocks.checkRateLimit.mockImplementation(() => {
      order.push('rate-limit');
      return { success: true };
    });
    mocks.hashInviteToken.mockImplementation((value: string) => {
      order.push('hash');
      expect(value).toBe(token);
      return tokenHash;
    });
    mocks.peekByTokenHash.mockImplementation(async (value: string) => {
      order.push('postgres-read');
      expect(value).toBe(tokenHash);
      return activePreview;
    });

    const response = await previewRequest();

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(activePreview);
    expect(mocks.checkRateLimit).toHaveBeenCalledWith('peek:203.0.113.10', {
      limit: 30,
      windowMs: 60_000,
    });
    expect(mocks.createPreviewRepository).toHaveBeenCalledTimes(1);
    expect(mocks.peekByTokenHash).toHaveBeenCalledWith(tokenHash);
    expect(mocks.createClient).not.toHaveBeenCalled();
    expect(order).toEqual(['rate-limit', 'hash', 'postgres-read']);
  });

  it.each(['not_found', 'expired', 'used'] as const)(
    'preserves the public %s response from the repository',
    async (reason) => {
      mocks.peekByTokenHash.mockResolvedValueOnce({ ok: false, reason });

      const response = await previewRequest();

      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({ ok: false, reason });
      expect(mocks.createClient).not.toHaveBeenCalled();
    }
  );

  it('returns the existing public not_found response for an empty token', async () => {
    const response = await previewRequest(undefined, '');

    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ ok: false, reason: 'not_found' });
    expect(mocks.hashInviteToken).not.toHaveBeenCalled();
    expect(mocks.createPreviewRepository).not.toHaveBeenCalled();
  });

  it('returns the rate-limit response before hashing or querying', async () => {
    const rateLimit = { success: false, remaining: 0, reset: 123, limit: 30 };
    mocks.checkRateLimit.mockReturnValueOnce(rateLimit);

    const response = await previewRequest();

    expect(response.status).toBe(429);
    expect(mocks.rateLimitResponse).toHaveBeenCalledWith(rateLimit);
    expect(mocks.hashInviteToken).not.toHaveBeenCalled();
    expect(mocks.createPreviewRepository).not.toHaveBeenCalled();
    expect(mocks.peekByTokenHash).not.toHaveBeenCalled();
    expect(mocks.createClient).not.toHaveBeenCalled();
  });

  it('hides repository failures behind the existing server_error response', async () => {
    const databaseError = new Error('synthetic database detail');
    mocks.peekByTokenHash.mockRejectedValueOnce(databaseError);
    const consoleError = vi
      .spyOn(console, 'error')
      .mockImplementation(() => {});

    const response = await previewRequest();
    const body = await response.json();

    expect(response.status).toBe(500);
    expect(body).toEqual({ ok: false, reason: 'server_error' });
    expect(JSON.stringify(body)).not.toContain('synthetic database detail');
    expect(consoleError).toHaveBeenCalled();
    expect(mocks.createClient).not.toHaveBeenCalled();
  });
});
