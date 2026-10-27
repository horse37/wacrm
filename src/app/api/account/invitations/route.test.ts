import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createHash } from 'node:crypto';

import { UnauthorizedError } from '@/lib/auth/account';
import { AppError } from '@/lib/db/errors';

const mocks = vi.hoisted(() => ({
  requireRole: vi.fn(),
  createRepository: vi.fn(),
  listOutstanding: vi.fn(),
  createInvitation: vi.fn(),
  checkRateLimit: vi.fn(),
  rateLimitResponse: vi.fn(),
  adminAction: { limit: 30, windowMs: 60_000 },
  supabaseFrom: vi.fn(),
  supabaseRpc: vi.fn(),
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

import { GET, POST } from './route';

const userId = '7d9d36e6-e4a8-4c1f-8f92-c8107c4a3d12';
const accountId = '6dd92bf4-8749-493d-914c-51a7d193cfc6';
const invitations = [
  {
    id: '965e9639-f97f-4a92-b4a2-6f385cd1a22c',
    role: 'admin',
    label: 'Synthetic invitation',
    created_by_user_id: userId,
    created_at: '2026-10-20T12:00:00.000Z',
    expires_at: '2026-10-27T12:00:00.000Z',
    accepted_at: null,
    accepted_by_user_id: null,
  },
];
const createdInvitation = {
  id: '6b4e25fd-157c-4f5a-8143-0df69a624ab3',
  role: 'agent',
  label: 'Broker team',
  created_at: '2026-10-20T12:00:00.000Z',
  expires_at: '2026-11-03T12:00:00.000Z',
};

const accountContext = {
  userId,
  accountId,
  role: 'admin',
  account: { id: accountId, name: 'Synthetic account' },
  supabase: { from: mocks.supabaseFrom, rpc: mocks.supabaseRpc },
};

describe('GET /api/account/invitations PostgreSQL route', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireRole.mockResolvedValue(accountContext);
    mocks.createRepository.mockReturnValue({
      listOutstanding: mocks.listOutstanding,
      create: mocks.createInvitation,
    });
    mocks.listOutstanding.mockResolvedValue(invitations);
    mocks.createInvitation.mockResolvedValue(createdInvitation);
    mocks.checkRateLimit.mockReturnValue({ success: true });
    mocks.rateLimitResponse.mockReturnValue(
      new Response(JSON.stringify({ error: 'Too many requests' }), {
        status: 429,
      })
    );
  });

  it('lists PostgreSQL invitations with the verified identity and existing shape', async () => {
    const order: string[] = [];
    mocks.requireRole.mockImplementation(async (role: string) => {
      order.push('admin-check');
      expect(role).toBe('admin');
      return accountContext;
    });
    mocks.createRepository.mockImplementation(() => {
      order.push('postgres-repository');
      return {
        listOutstanding: async () => {
          order.push('postgres-query');
          return invitations;
        },
      };
    });

    const response = await GET();

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ invitations });
    expect(order).toEqual([
      'admin-check',
      'postgres-repository',
      'postgres-query',
    ]);
    expect(mocks.createRepository).toHaveBeenCalledTimes(1);
    const [getVerifiedSession] = mocks.createRepository.mock.calls[0];
    await expect(getVerifiedSession()).resolves.toEqual({ userId });
    expect(mocks.requireRole).toHaveBeenCalledTimes(1);
    expect(mocks.supabaseFrom).not.toHaveBeenCalled();
    expect(mocks.supabaseRpc).not.toHaveBeenCalled();
  });

  it('returns authorization errors before constructing the repository', async () => {
    mocks.requireRole.mockRejectedValueOnce(new UnauthorizedError());

    const response = await GET();

    expect(response.status).toBe(401);
    expect(mocks.createRepository).not.toHaveBeenCalled();
    expect(mocks.supabaseFrom).not.toHaveBeenCalled();
    expect(mocks.supabaseRpc).not.toHaveBeenCalled();
  });

  it('maps PostgreSQL permission errors to a safe 403 response', async () => {
    mocks.listOutstanding.mockRejectedValueOnce(
      new AppError('db_error', '42501')
    );

    const response = await GET();

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toEqual({ error: 'Forbidden' });
  });

  it('keeps unexpected database errors generic', async () => {
    const errorSpy = vi
      .spyOn(console, 'error')
      .mockImplementation(() => undefined);
    mocks.listOutstanding.mockRejectedValueOnce(new AppError('db_error'));

    const response = await GET();

    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toEqual({
      error: 'Failed to load invitations',
    });
    expect(errorSpy).toHaveBeenCalledTimes(1);
  });
});

describe('POST /api/account/invitations PostgreSQL route', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
  });

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireRole.mockResolvedValue(accountContext);
    mocks.createRepository.mockReturnValue({ create: mocks.createInvitation });
    mocks.createInvitation.mockResolvedValue(createdInvitation);
    mocks.checkRateLimit.mockReturnValue({ success: true });
    mocks.rateLimitResponse.mockReturnValue(
      new Response(JSON.stringify({ error: 'Too many requests' }), {
        status: 429,
      })
    );
  });

  it('persists only the token hash after admin and per-user rate checks', async () => {
    vi.stubEnv('NEXT_PUBLIC_SITE_URL', 'https://app.example.test');
    const order: string[] = [];
    mocks.requireRole.mockImplementation(async (role: string) => {
      order.push('admin-check');
      expect(role).toBe('admin');
      return accountContext;
    });
    mocks.checkRateLimit.mockImplementation((key: string, limits: unknown) => {
      order.push('rate-limit');
      expect(key).toBe(`admin:inviteCreate:${userId}`);
      expect(limits).toBe(mocks.adminAction);
      return { success: true };
    });
    mocks.createRepository.mockImplementation(() => {
      order.push('postgres-repository');
      return {
        create: async (...args: unknown[]) => {
          order.push('postgres-create');
          return mocks.createInvitation(...args);
        },
      };
    });
    const request = new Request(
      'https://app.example.test/api/account/invitations',
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          role: 'agent',
          label: ' Broker team ',
          expiresInDays: 14,
        }),
      }
    );
    const requestStartedAt = Date.now();
    const parseJson = request.json.bind(request);
    request.json = async () => {
      order.push('body');
      return parseJson();
    };

    const response = await POST(request);
    const payload = await response.json();

    expect(response.status).toBe(201);
    expect(order).toEqual([
      'admin-check',
      'rate-limit',
      'body',
      'postgres-repository',
      'postgres-create',
    ]);
    expect(payload).toMatchObject({
      invitation: createdInvitation,
      url: `https://app.example.test/join/${payload.token}`,
      expiresInDays: 14,
    });
    expect(payload.token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    const [input] = mocks.createInvitation.mock.calls[0];
    expect(input).toEqual({
      role: 'agent',
      tokenHash: createHash('sha256').update(payload.token).digest('hex'),
      label: 'Broker team',
      expiresAt: expect.any(String),
    });
    const expiryDelta = Date.parse(input.expiresAt) - requestStartedAt;
    expect(expiryDelta).toBeGreaterThanOrEqual(14 * 24 * 60 * 60 * 1000);
    expect(expiryDelta).toBeLessThanOrEqual(14 * 24 * 60 * 60 * 1000 + 1000);
    expect(Object.hasOwn(input, 'token')).toBe(false);
    expect(input.tokenHash).not.toBe(payload.token);
    expect(mocks.createRepository).toHaveBeenCalledTimes(1);
    const [getVerifiedSession] = mocks.createRepository.mock.calls[0];
    await expect(getVerifiedSession()).resolves.toEqual({ userId });
    expect(mocks.supabaseFrom).not.toHaveBeenCalled();
    expect(mocks.supabaseRpc).not.toHaveBeenCalled();
  });

  it('denies unauthorized callers before rate limiting or reading the body', async () => {
    mocks.requireRole.mockRejectedValueOnce(new UnauthorizedError());
    const request = new Request(
      'https://app.example.test/api/account/invitations',
      {
        method: 'POST',
        body: '{invalid json',
      }
    );
    const parseJson = vi.spyOn(request, 'json');

    const response = await POST(request);

    expect(response.status).toBe(401);
    expect(mocks.checkRateLimit).not.toHaveBeenCalled();
    expect(parseJson).not.toHaveBeenCalled();
    expect(mocks.createRepository).not.toHaveBeenCalled();
  });

  it('returns rate-limit response before parsing or writing an invitation', async () => {
    mocks.checkRateLimit.mockReturnValueOnce({
      success: false,
      retryAfter: 60,
    });
    const request = new Request(
      'https://app.example.test/api/account/invitations',
      {
        method: 'POST',
        body: '{invalid json',
      }
    );
    const parseJson = vi.spyOn(request, 'json');

    const response = await POST(request);

    expect(response.status).toBe(429);
    expect(mocks.rateLimitResponse).toHaveBeenCalledTimes(1);
    expect(parseJson).not.toHaveBeenCalled();
    expect(mocks.createRepository).not.toHaveBeenCalled();
  });

  it('rejects owner and overlong labels without creating a repository', async () => {
    const ownerResponse = await POST(
      new Request('https://app.example.test/api/account/invitations', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ role: 'owner' }),
      })
    );
    const labelResponse = await POST(
      new Request('https://app.example.test/api/account/invitations', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ role: 'agent', label: 'x'.repeat(81) }),
      })
    );

    expect(ownerResponse.status).toBe(400);
    expect(labelResponse.status).toBe(400);
    expect(mocks.createRepository).not.toHaveBeenCalled();
    expect(mocks.createInvitation).not.toHaveBeenCalled();
  });

  it('returns safe 403 and generic 500 for repository failures', async () => {
    const errorSpy = vi
      .spyOn(console, 'error')
      .mockImplementation(() => undefined);
    mocks.createInvitation
      .mockRejectedValueOnce(new AppError('db_error', '42501'))
      .mockRejectedValueOnce(new Error('sensitive database detail'));
    const request = () =>
      new Request('https://app.example.test/api/account/invitations', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ role: 'agent' }),
      });

    const forbidden = await POST(request());
    const failed = await POST(request());
    const failedBody = await failed.json();

    expect(forbidden.status).toBe(403);
    await expect(forbidden.json()).resolves.toEqual({ error: 'Forbidden' });
    expect(failed.status).toBe(500);
    expect(failedBody).toEqual({
      error: 'Failed to create invitation',
    });
    expect(JSON.stringify(failedBody)).not.toContain(
      'sensitive database detail'
    );
    expect(errorSpy).toHaveBeenCalledTimes(1);
  });
});
