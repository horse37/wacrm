import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AppError } from '@/lib/db/errors';

const mocks = vi.hoisted(() => ({
  checkRateLimit: vi.fn(),
  rateLimitResponse: vi.fn(),
  hashInviteToken: vi.fn(),
  createClient: vi.fn(),
  getUser: vi.fn(),
  rpc: vi.fn(),
  createRedemptionRepository: vi.fn(),
  redeemByTokenHash: vi.fn(),
}));

vi.mock('@/lib/rate-limit', () => ({
  checkRateLimit: mocks.checkRateLimit,
  rateLimitResponse: mocks.rateLimitResponse,
  RATE_LIMITS: { invitationRedeem: { limit: 5, windowMs: 60_000 } },
}));
vi.mock('@/lib/auth/invitations', () => ({
  hashInviteToken: mocks.hashInviteToken,
}));
vi.mock('@/lib/supabase/server', () => ({ createClient: mocks.createClient }));
vi.mock('@/lib/repositories/invitation-redemption', () => ({
  createPostgresInvitationRedemptionRepository:
    mocks.createRedemptionRepository,
}));

import { POST } from './route';

const token = 'synthetic-invitation-token';
const tokenHash = 'b'.repeat(64);
const userId = '7d9d36e6-e4a8-4c1f-8f92-c8107c4a3d12';
const accountId = '6dd92bf4-8749-493d-914c-51a7d193cfc6';

function postRequest(
  request = new Request(
    'https://wacrm.example.test/api/invitations/token/redeem',
    {
      method: 'POST',
      headers: { 'x-forwarded-for': '203.0.113.20, 10.0.0.1' },
    }
  )
) {
  return POST(request, { params: Promise.resolve({ token }) });
}

describe('POST /api/invitations/[token]/redeem', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.checkRateLimit.mockReturnValue({ success: true });
    mocks.rateLimitResponse.mockImplementation(() =>
      Response.json({ error: 'rate_limited' }, { status: 429 })
    );
    mocks.hashInviteToken.mockReturnValue(tokenHash);
    mocks.getUser.mockResolvedValue({ data: { user: { id: userId } } });
    mocks.createClient.mockResolvedValue({
      auth: { getUser: mocks.getUser },
      rpc: mocks.rpc,
    });
    mocks.createRedemptionRepository.mockReturnValue({
      redeemByTokenHash: mocks.redeemByTokenHash,
    });
    mocks.redeemByTokenHash.mockResolvedValue(accountId);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('rate-limits first, verifies session, hashes token, then redeems through PostgreSQL', async () => {
    const order: string[] = [];
    mocks.checkRateLimit.mockImplementation(() => {
      order.push('rate-limit');
      return { success: true };
    });
    mocks.getUser.mockImplementation(async () => {
      order.push('verified-session');
      return { data: { user: { id: userId } } };
    });
    mocks.hashInviteToken.mockImplementation((value: string) => {
      order.push('hash');
      expect(value).toBe(token);
      return tokenHash;
    });
    mocks.redeemByTokenHash.mockImplementation(async (value: string) => {
      order.push('postgres-redeem');
      expect(value).toBe(tokenHash);
      return accountId;
    });

    const response = await postRequest();

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true, accountId });
    expect(mocks.checkRateLimit).toHaveBeenCalledWith('redeem:203.0.113.20', {
      limit: 5,
      windowMs: 60_000,
    });
    expect(mocks.createRedemptionRepository).toHaveBeenCalledTimes(1);
    expect(mocks.createRedemptionRepository).toHaveBeenCalledWith(
      expect.any(Function)
    );
    expect(mocks.redeemByTokenHash).toHaveBeenCalledWith(tokenHash);
    expect(mocks.rpc).not.toHaveBeenCalled();
    const [getVerifiedSession] = mocks.createRedemptionRepository.mock.calls[0];
    await expect(getVerifiedSession()).resolves.toEqual({ userId });
    expect(order).toEqual([
      'rate-limit',
      'verified-session',
      'hash',
      'postgres-redeem',
    ]);
  });

  it('returns the existing 401 response when no verified session exists', async () => {
    mocks.getUser.mockResolvedValueOnce({ data: { user: null } });

    const response = await postRequest();

    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: 'Unauthorized' });
    expect(mocks.hashInviteToken).not.toHaveBeenCalled();
    expect(mocks.createRedemptionRepository).not.toHaveBeenCalled();
  });

  it('rate-limits before session lookup, hashing, or repository access', async () => {
    const rateLimit = { success: false, remaining: 0, reset: 123, limit: 5 };
    mocks.checkRateLimit.mockReturnValueOnce(rateLimit);

    const response = await postRequest();

    expect(response.status).toBe(429);
    expect(mocks.rateLimitResponse).toHaveBeenCalledWith(rateLimit);
    expect(mocks.createClient).not.toHaveBeenCalled();
    expect(mocks.hashInviteToken).not.toHaveBeenCalled();
    expect(mocks.createRedemptionRepository).not.toHaveBeenCalled();
  });

  it('preserves the missing-token response before session lookup', async () => {
    const response = await POST(
      new Request('https://wacrm.example.test/redeem', {
        method: 'POST',
      }),
      { params: Promise.resolve({ token: '' }) }
    );

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      error: 'Missing invitation token',
    });
    expect(mocks.createClient).not.toHaveBeenCalled();
    expect(mocks.hashInviteToken).not.toHaveBeenCalled();
    expect(mocks.createRedemptionRepository).not.toHaveBeenCalled();
  });

  it.each([
    ['unauthorized', 401, 'Unauthorized'],
    ['forbidden', 401, 'You are not allowed to accept this invitation.'],
    [
      'bad_request',
      400,
      'This invitation is invalid, already used, or expired.',
    ],
    ['not_found', 400, 'This invitation is invalid, already used, or expired.'],
    [
      'conflict',
      409,
      'Your account cannot accept this invitation. Sign up with a different email to join this one.',
    ],
    ['db_error', 500, 'Failed to redeem invitation'],
  ] as const)(
    'maps repository %s failures to safe HTTP responses',
    async (code, status, message) => {
      mocks.redeemByTokenHash.mockRejectedValueOnce(new AppError(code));

      const response = await postRequest();
      const body = await response.json();

      expect(response.status).toBe(status);
      expect(body).toEqual({ error: message });
      expect(JSON.stringify(body)).not.toContain(tokenHash);
      expect(mocks.rpc).not.toHaveBeenCalled();
    }
  );

  it('sanitizes unexpected database errors behind the existing 500 response', async () => {
    mocks.redeemByTokenHash.mockRejectedValueOnce(
      new Error('synthetic database detail')
    );
    const consoleError = vi
      .spyOn(console, 'error')
      .mockImplementation(() => {});

    const response = await postRequest();
    const body = await response.json();

    expect(response.status).toBe(500);
    expect(body).toEqual({ error: 'Failed to redeem invitation' });
    expect(JSON.stringify(body)).not.toContain('synthetic database detail');
    expect(consoleError).toHaveBeenCalled();
  });
});
