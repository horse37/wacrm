import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ForbiddenError } from '@/lib/auth/account';
import { AppError } from '@/lib/db/errors';

const mocks = vi.hoisted(() => ({
  requireRole: vi.fn(),
  checkRateLimit: vi.fn(),
  rateLimitResponse: vi.fn(),
  rpc: vi.fn(),
  createRoleRepository: vi.fn(),
  setRole: vi.fn(),
  createRemovalRepository: vi.fn(),
  removeMember: vi.fn(),
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

vi.mock('@/lib/repositories/account-member-role', () => ({
  createPostgresAccountMemberRoleRepository: mocks.createRoleRepository,
}));

vi.mock('@/lib/repositories/account-member-removal', () => ({
  createPostgresAccountMemberRemovalRepository: mocks.createRemovalRepository,
}));

import { DELETE, PATCH } from './route';

const userId = '7d9d36e6-e4a8-4c1f-8f92-c8107c4a3d12';
const targetUserId = '8d9d36e6-e4a8-4c1f-8f92-c8107c4a3d12';
const accountId = '6dd92bf4-8749-493d-914c-51a7d193cfc6';
const personalAccountId = '9dd92bf4-8749-493d-914c-51a7d193cfc6';
const adminContext = {
  userId,
  accountId,
  role: 'admin',
  account: { id: accountId, name: 'Synthetic account' },
  supabase: { rpc: mocks.rpc },
};

function routeContext(userIdValue = targetUserId) {
  return { params: Promise.resolve({ userId: userIdValue }) };
}

function patchRequest(body: unknown = { role: 'agent' }) {
  return new Request(
    'https://wacrm.example.test/api/account/members/' + targetUserId,
    {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    }
  );
}

function deleteRequest() {
  return new Request(
    'https://wacrm.example.test/api/account/members/' + targetUserId,
    { method: 'DELETE' }
  );
}

describe('/api/account/members/[userId] PostgreSQL routes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireRole.mockResolvedValue(adminContext);
    mocks.checkRateLimit.mockReturnValue({ success: true });
    mocks.rateLimitResponse.mockImplementation(() =>
      Response.json({ error: 'rate_limited' }, { status: 429 })
    );
    mocks.createRoleRepository.mockReturnValue({ setRole: mocks.setRole });
    mocks.setRole.mockResolvedValue(undefined);
    mocks.createRemovalRepository.mockReturnValue({
      removeMember: mocks.removeMember,
    });
    mocks.removeMember.mockResolvedValue(personalAccountId);
  });

  it('PATCH requires admin, rate-limits, then changes role through PostgreSQL', async () => {
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
    mocks.createRoleRepository.mockImplementation(() => {
      order.push('repository');
      return { setRole: mocks.setRole };
    });
    mocks.setRole.mockImplementation(async () => {
      order.push('postgres-role-change');
    });

    const response = await PATCH(patchRequest(), routeContext());

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ ok: true });
    expect(mocks.checkRateLimit).toHaveBeenCalledWith(
      `admin:memberRole:${userId}`,
      { limit: 30, windowMs: 60_000 }
    );
    expect(mocks.createRoleRepository).toHaveBeenCalledTimes(1);
    expect(mocks.setRole).toHaveBeenCalledWith(targetUserId, 'agent');
    const [getVerifiedSession] = mocks.createRoleRepository.mock.calls[0];
    await expect(getVerifiedSession()).resolves.toEqual({ userId });
    expect(order).toEqual([
      'admin-guard',
      'rate-limit',
      'repository',
      'postgres-role-change',
    ]);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it('PATCH stops on rate limit before parsing the body or opening the repository', async () => {
    const limit = { success: false, remaining: 0, reset: 123, limit: 30 };
    mocks.checkRateLimit.mockReturnValueOnce(limit);
    const request = { json: vi.fn() } as unknown as Request;

    const response = await PATCH(request, routeContext());

    expect(response.status).toBe(429);
    expect(mocks.rateLimitResponse).toHaveBeenCalledWith(limit);
    expect(request.json).not.toHaveBeenCalled();
    expect(mocks.createRoleRepository).not.toHaveBeenCalled();
  });

  it('PATCH preserves admin authorization failures before rate limiting', async () => {
    mocks.requireRole.mockRejectedValueOnce(new ForbiddenError());

    const response = await PATCH(patchRequest(), routeContext());

    expect(response.status).toBe(403);
    expect(mocks.checkRateLimit).not.toHaveBeenCalled();
    expect(mocks.createRoleRepository).not.toHaveBeenCalled();
  });

  it.each([
    [{ role: 'unknown' }, "'role' must be one of owner, admin, agent, viewer"],
    [
      { role: 'owner' },
      'Use POST /api/account/transfer-ownership to promote a member to owner',
    ],
  ])(
    'PATCH rejects invalid role request %j without opening repository',
    async (body, error) => {
      const response = await PATCH(patchRequest(body), routeContext());

      expect(response.status).toBe(400);
      await expect(response.json()).resolves.toEqual({ error });
      expect(mocks.createRoleRepository).not.toHaveBeenCalled();
    }
  );

  it('PATCH maps repository authorization errors to 403', async () => {
    mocks.setRole.mockRejectedValueOnce({
      code: '42501',
      message: 'private database detail',
    });

    const response = await PATCH(patchRequest(), routeContext());

    expect(response.status).toBe(403);
    expect(await response.text()).not.toContain('private database detail');
  });

  it('PATCH maps repository target authorization failures to 403', async () => {
    mocks.setRole.mockRejectedValueOnce(new AppError('forbidden'));

    const response = await PATCH(patchRequest(), routeContext());

    expect(response.status).toBe(403);
  });

  it('DELETE rate-limits, removes through PostgreSQL, and returns the new personal account ID', async () => {
    const response = await DELETE(deleteRequest(), routeContext());

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      ok: true,
      newPersonalAccountId: personalAccountId,
    });
    expect(mocks.checkRateLimit).toHaveBeenCalledWith(
      `admin:memberRemove:${userId}`,
      { limit: 30, windowMs: 60_000 }
    );
    expect(mocks.createRemovalRepository).toHaveBeenCalledTimes(1);
    expect(mocks.removeMember).toHaveBeenCalledWith(targetUserId);
    const [getVerifiedSession] = mocks.createRemovalRepository.mock.calls[0];
    await expect(getVerifiedSession()).resolves.toEqual({ userId });
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it('DELETE stops on rate limit before opening the repository', async () => {
    const limit = { success: false, remaining: 0, reset: 123, limit: 30 };
    mocks.checkRateLimit.mockReturnValueOnce(limit);

    const response = await DELETE(deleteRequest(), routeContext());

    expect(response.status).toBe(429);
    expect(mocks.rateLimitResponse).toHaveBeenCalledWith(limit);
    expect(mocks.createRemovalRepository).not.toHaveBeenCalled();
  });

  it('DELETE maps invalid database requests to 400 without exposing database text', async () => {
    mocks.removeMember.mockRejectedValueOnce({
      code: '22023',
      message: 'private database detail',
    });

    const response = await DELETE(deleteRequest(), routeContext());

    expect(response.status).toBe(400);
    expect(await response.text()).not.toContain('private database detail');
  });

  it('DELETE returns the same safe not-found response for unavailable targets', async () => {
    mocks.removeMember.mockRejectedValueOnce(new AppError('not_found'));

    const response = await DELETE(deleteRequest(), routeContext());

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toEqual({
      error: 'The requested resource was not found.',
    });
  });
});
