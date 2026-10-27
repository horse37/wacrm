import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ForbiddenError } from '@/lib/auth/account';
import { AppError } from '@/lib/db/errors';

const mocks = vi.hoisted(() => ({
  requireRole: vi.fn(),
  checkRateLimit: vi.fn(),
  rateLimitResponse: vi.fn(),
  rpc: vi.fn(),
  createRepository: vi.fn(),
  transferTo: vi.fn(),
}));

vi.mock('@/lib/auth/account', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/auth/account')>()),
  requireRole: mocks.requireRole,
}));

vi.mock('@/lib/rate-limit', () => ({
  checkRateLimit: mocks.checkRateLimit,
  rateLimitResponse: mocks.rateLimitResponse,
  RATE_LIMITS: { adminAction: { limit: 30, windowMs: 60_000 } },
}));

vi.mock('@/lib/repositories/account-ownership-transfer', () => ({
  createPostgresAccountOwnershipTransferRepository: mocks.createRepository,
}));

import { POST } from './route';

const userId = '7d9d36e6-e4a8-4c1f-8f92-c8107c4a3d12';
const newOwnerUserId = '8d9d36e6-e4a8-4c1f-8f92-c8107c4a3d12';
const accountId = '6dd92bf4-8749-493d-914c-51a7d193cfc6';
const ownerContext = {
  userId,
  accountId,
  role: 'owner',
  account: { id: accountId, name: 'Synthetic account' },
  supabase: { rpc: mocks.rpc },
};

function postRequest(body: unknown = { newOwnerUserId }) {
  return new Request(
    'https://wacrm.example.test/api/account/transfer-ownership',
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    }
  );
}

describe('POST /api/account/transfer-ownership', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireRole.mockResolvedValue(ownerContext);
    mocks.checkRateLimit.mockReturnValue({ success: true });
    mocks.rateLimitResponse.mockImplementation(() =>
      Response.json({ error: 'rate_limited' }, { status: 429 })
    );
    mocks.createRepository.mockReturnValue({ transferTo: mocks.transferTo });
    mocks.transferTo.mockResolvedValue(undefined);
  });

  it('requires the owner guard, rate-limits, then transfers through PostgreSQL', async () => {
    const order: string[] = [];
    mocks.requireRole.mockImplementation(async (role: string) => {
      order.push('owner-guard');
      expect(role).toBe('owner');
      return ownerContext;
    });
    mocks.checkRateLimit.mockImplementation(() => {
      order.push('rate-limit');
      return { success: true };
    });
    mocks.createRepository.mockImplementation(() => {
      order.push('repository');
      return { transferTo: mocks.transferTo };
    });
    mocks.transferTo.mockImplementation(async () => {
      order.push('postgres-transfer');
    });

    const response = await POST(postRequest());

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true });
    expect(mocks.checkRateLimit).toHaveBeenCalledWith(
      `admin:transferOwnership:${userId}`,
      { limit: 30, windowMs: 60_000 }
    );
    expect(mocks.createRepository).toHaveBeenCalledTimes(1);
    expect(mocks.transferTo).toHaveBeenCalledWith(newOwnerUserId);
    expect(mocks.rpc).not.toHaveBeenCalled();
    const [getVerifiedSession] = mocks.createRepository.mock.calls[0];
    await expect(getVerifiedSession()).resolves.toEqual({ userId });
    expect(order).toEqual([
      'owner-guard',
      'rate-limit',
      'repository',
      'postgres-transfer',
    ]);
  });

  it('stops after rate limiting before reading input or opening the repository', async () => {
    const limit = { success: false, remaining: 0, reset: 123, limit: 30 };
    mocks.checkRateLimit.mockReturnValueOnce(limit);
    const request = { json: vi.fn() } as unknown as Request;

    const response = await POST(request);

    expect(response.status).toBe(429);
    expect(mocks.rateLimitResponse).toHaveBeenCalledWith(limit);
    expect(request.json).not.toHaveBeenCalled();
    expect(mocks.createRepository).not.toHaveBeenCalled();
  });

  it('preserves owner authorization failures before rate limiting', async () => {
    mocks.requireRole.mockRejectedValueOnce(new ForbiddenError());

    const response = await POST(postRequest());

    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ error: 'Forbidden' });
    expect(mocks.checkRateLimit).not.toHaveBeenCalled();
    expect(mocks.createRepository).not.toHaveBeenCalled();
  });

  it('preserves invalid UUID response without repository access', async () => {
    const response = await POST(postRequest({ newOwnerUserId: 'not-a-uuid' }));

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      error: "'newOwnerUserId' must be a valid UUID",
    });
    expect(mocks.createRepository).not.toHaveBeenCalled();
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it.each([
    ['unauthorized', 401],
    ['forbidden', 403],
    ['bad_request', 400],
    ['not_found', 404],
    ['conflict', 409],
  ] as const)(
    'maps repository %s errors to safe HTTP responses',
    async (code, status) => {
      mocks.transferTo.mockRejectedValueOnce(new AppError(code));

      const response = await POST(postRequest());
      const body = await response.json();

      expect(response.status).toBe(status);
      expect(body).toEqual({ error: expect.any(String) });
      expect(JSON.stringify(body)).not.toContain(userId);
      expect(mocks.rpc).not.toHaveBeenCalled();
    }
  );

  it.each([
    ['42501', 403],
    ['22023', 400],
  ] as const)(
    'preserves the existing status for SQLSTATE %s',
    async (sqlState, status) => {
      const error = { code: sqlState };
      mocks.transferTo.mockRejectedValueOnce(error);

      const response = await POST(postRequest());

      expect(response.status).toBe(status);
    }
  );

  it('sanitizes unexpected database failures behind the existing 500 response', async () => {
    mocks.transferTo.mockRejectedValueOnce(
      new Error('synthetic database detail')
    );
    const consoleError = vi
      .spyOn(console, 'error')
      .mockImplementation(() => {});

    const response = await POST(postRequest());
    const body = await response.json();

    expect(response.status).toBe(500);
    expect(body).toEqual({ error: 'Failed to transfer ownership' });
    expect(JSON.stringify(body)).not.toContain('synthetic database detail');
    expect(consoleError).toHaveBeenCalled();
  });
});
