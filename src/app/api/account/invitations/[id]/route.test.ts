import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { AppError } from '@/lib/db/errors';

const mocks = vi.hoisted(() => ({
  requireRole: vi.fn(),
  createRepository: vi.fn(),
  revoke: vi.fn(),
  checkRateLimit: vi.fn(),
  rateLimitResponse: vi.fn(),
  supabaseFrom: vi.fn(),
  adminAction: { limit: 30, windowMs: 60_000 },
}));

vi.mock('@/lib/auth/account', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/auth/account')>()),
  requireRole: mocks.requireRole,
}));

vi.mock('@/lib/repositories/account-invitations', () => ({
  createPostgresAccountInvitationsRepository: mocks.createRepository,
}));

vi.mock('@/lib/rate-limit', () => ({
  checkRateLimit: mocks.checkRateLimit,
  rateLimitResponse: mocks.rateLimitResponse,
  RATE_LIMITS: { adminAction: mocks.adminAction },
}));

import { DELETE } from './route';

const userId = '7d9d36e6-e4a8-4c1f-8f92-c8107c4a3d12';
const invitationId = '965e9639-f97f-4a92-b4a2-6f385cd1a22c';
const adminContext = {
  userId,
  accountId: '6dd92bf4-8749-493d-914c-51a7d193cfc6',
  role: 'admin',
  account: {
    id: '6dd92bf4-8749-493d-914c-51a7d193cfc6',
    name: 'Synthetic account',
  },
  supabase: { from: mocks.supabaseFrom },
};

function routeContext(id = invitationId) {
  return { params: Promise.resolve({ id }) };
}

function request() {
  return new Request(
    `https://wacrm.example.test/api/account/invitations/${invitationId}`,
    { method: 'DELETE' }
  );
}

describe('DELETE /api/account/invitations/[id] PostgreSQL route', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, 'error').mockImplementation(() => {});
    mocks.requireRole.mockResolvedValue(adminContext);
    mocks.createRepository.mockReturnValue({ revoke: mocks.revoke });
    mocks.revoke.mockResolvedValue(true);
    mocks.checkRateLimit.mockReturnValue({ success: true });
    mocks.rateLimitResponse.mockReturnValue(
      new Response(JSON.stringify({ error: 'Rate limit exceeded' }), {
        status: 429,
      })
    );
    mocks.supabaseFrom.mockImplementation(() => {
      throw new Error('Unexpected Supabase data access');
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('revokes through PostgreSQL and returns the existing success response', async () => {
    const response = await DELETE(request(), routeContext());

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ ok: true });
    expect(mocks.requireRole).toHaveBeenCalledWith('admin');
    expect(mocks.checkRateLimit).toHaveBeenCalledWith(
      `admin:inviteRevoke:${userId}`,
      mocks.adminAction
    );
    expect(mocks.createRepository).toHaveBeenCalledWith(expect.any(Function));
    const verifiedSession = mocks.createRepository.mock.calls[0][0];
    await expect(verifiedSession()).resolves.toEqual({ userId });
    expect(mocks.revoke).toHaveBeenCalledWith(invitationId);
    expect(mocks.supabaseFrom).not.toHaveBeenCalled();
  });

  it('returns 404 when the invitation is absent or outside the caller account', async () => {
    mocks.revoke.mockResolvedValue(false);

    const response = await DELETE(request(), routeContext());

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toEqual({
      error: 'Invitation not found',
    });
  });

  it('stops before repository access when the admin action is rate limited', async () => {
    mocks.checkRateLimit.mockReturnValue({ success: false });

    const response = await DELETE(request(), routeContext());

    expect(response.status).toBe(429);
    expect(mocks.rateLimitResponse).toHaveBeenCalledWith({ success: false });
    expect(mocks.createRepository).not.toHaveBeenCalled();
    expect(mocks.revoke).not.toHaveBeenCalled();
  });

  it('maps PostgreSQL permission denial to a safe forbidden response', async () => {
    mocks.revoke.mockRejectedValue(new AppError('db_error', '42501'));

    const response = await DELETE(request(), routeContext());

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toEqual({ error: 'Forbidden' });
  });

  it('hides unexpected PostgreSQL details behind a generic server error', async () => {
    mocks.revoke.mockRejectedValue(new AppError('db_error'));

    const response = await DELETE(request(), routeContext());

    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toEqual({
      error: 'Failed to revoke invitation',
    });
  });
});
