import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ForbiddenError } from '@/lib/auth/account';
import { AppError } from '@/lib/db/errors';

const mocks = vi.hoisted(() => ({
  requireRole: vi.fn(),
  checkRateLimit: vi.fn(),
  rateLimitResponse: vi.fn(),
  supabaseFrom: vi.fn(),
  createRepository: vi.fn(),
  rename: vi.fn(),
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

vi.mock('@/lib/repositories/accounts', () => ({
  createPostgresAccountRepository: mocks.createRepository,
}));

import { PATCH } from './route';

const userId = '7d9d36e6-e4a8-4c1f-8f92-c8107c4a3d12';
const accountId = '6dd92bf4-8749-493d-914c-51a7d193cfc6';
const account = { id: accountId, name: 'Synthetic account' };
const adminContext = {
  userId,
  accountId,
  role: 'admin',
  account,
  supabase: { from: mocks.supabaseFrom },
};

function patchRequest(body: unknown = { name: 'New account name' }) {
  return new Request('https://wacrm.example.test/api/account', {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

describe('PATCH /api/account PostgreSQL route', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireRole.mockResolvedValue(adminContext);
    mocks.checkRateLimit.mockReturnValue({ success: true });
    mocks.rateLimitResponse.mockImplementation(() =>
      Response.json({ error: 'rate_limited' }, { status: 429 })
    );
    mocks.createRepository.mockReturnValue({ rename: mocks.rename });
    mocks.rename.mockResolvedValue({ id: accountId, name: 'New account name' });
    mocks.supabaseFrom.mockReturnValue({
      update: vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnValue({
          select: vi.fn().mockReturnValue({
            single: vi.fn().mockResolvedValue({ data: account, error: null }),
          }),
        }),
      }),
    });
  });

  it('requires admin, rate-limits, and renames through PostgreSQL', async () => {
    const order: string[] = [];
    mocks.requireRole.mockImplementation(async (role: string) => {
      order.push('admin-guard');
      expect(role).toBe('admin');
      return adminContext;
    });
    mocks.checkRateLimit.mockImplementation(() => {
      order.push('rate-limit');
      return { success: true };
    });
    mocks.createRepository.mockImplementation(() => {
      order.push('postgres-repository');
      return { rename: mocks.rename };
    });
    mocks.rename.mockImplementation(async () => {
      order.push('postgres-rename');
      return { id: accountId, name: 'New account name' };
    });

    const response = await PATCH(
      patchRequest({ name: '  New account name  ' })
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      account: { id: accountId, name: 'New account name' },
    });
    expect(mocks.checkRateLimit).toHaveBeenCalledWith(
      `admin:rename:${userId}`,
      { limit: 30, windowMs: 60_000 }
    );
    expect(mocks.createRepository).toHaveBeenCalledTimes(1);
    const [getVerifiedSession] = mocks.createRepository.mock.calls[0];
    await expect(getVerifiedSession()).resolves.toEqual({ userId });
    expect(mocks.rename).toHaveBeenCalledWith('New account name');
    expect(mocks.supabaseFrom).not.toHaveBeenCalled();
    expect(order).toEqual([
      'admin-guard',
      'rate-limit',
      'postgres-repository',
      'postgres-rename',
    ]);
  });

  it('stops on rate limit before parsing the body or opening the repository', async () => {
    const limit = { success: false, remaining: 0, reset: 123, limit: 30 };
    mocks.checkRateLimit.mockReturnValueOnce(limit);
    const request = { json: vi.fn() } as unknown as Request;

    const response = await PATCH(request);

    expect(response.status).toBe(429);
    expect(mocks.rateLimitResponse).toHaveBeenCalledWith(limit);
    expect(request.json).not.toHaveBeenCalled();
    expect(mocks.createRepository).not.toHaveBeenCalled();
  });

  it('preserves admin authorization before rate limiting', async () => {
    mocks.requireRole.mockRejectedValueOnce(new ForbiddenError());

    const response = await PATCH(patchRequest());

    expect(response.status).toBe(403);
    expect(mocks.checkRateLimit).not.toHaveBeenCalled();
    expect(mocks.createRepository).not.toHaveBeenCalled();
  });

  it.each([
    [null, "'name' must be a string"],
    [{ name: '  ' }, 'Account name cannot be empty'],
    [{ name: 'x'.repeat(81) }, 'Account name must be 80 characters or fewer'],
  ])('preserves name validation for %j', async (body, error) => {
    const response = await PATCH(patchRequest(body));

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({ error });
    expect(mocks.createRepository).not.toHaveBeenCalled();
  });

  it('maps PostgreSQL role denial to 403', async () => {
    mocks.rename.mockRejectedValueOnce(new AppError('forbidden'));

    const response = await PATCH(patchRequest());

    expect(response.status).toBe(403);
  });

  it('maps PostgreSQL permission errors to 403 without exposing database text', async () => {
    mocks.rename.mockRejectedValueOnce({
      code: '42501',
      message: 'private database detail',
    });

    const response = await PATCH(patchRequest());

    expect(response.status).toBe(403);
    expect(await response.text()).not.toContain('private database detail');
  });

  it('maps missing PostgreSQL account to 404 without exposing database details', async () => {
    mocks.rename.mockRejectedValueOnce(new AppError('not_found'));

    const response = await PATCH(patchRequest());

    expect(response.status).toBe(404);
    expect(await response.text()).not.toContain('private database detail');
  });

  it('keeps unexpected PostgreSQL errors generic', async () => {
    mocks.rename.mockRejectedValueOnce(new Error('private database detail'));

    const response = await PATCH(patchRequest());

    expect(response.status).toBe(500);
    const body = await response.json();
    expect(body).toEqual({ error: 'Failed to update account' });
    expect(JSON.stringify(body)).not.toContain('private database detail');
  });
});
