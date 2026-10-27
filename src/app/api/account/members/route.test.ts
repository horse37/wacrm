import { beforeEach, describe, expect, it, vi } from 'vitest';
import { UnauthorizedError } from '@/lib/auth/account';
import { AppError } from '@/lib/db/errors';

const mocks = vi.hoisted(() => ({
  getCurrentAccount: vi.fn(),
  createRepository: vi.fn(),
  listMembers: vi.fn(),
  supabaseFrom: vi.fn(),
}));

vi.mock('@/lib/auth/account', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/auth/account')>()),
  getCurrentAccount: mocks.getCurrentAccount,
}));

vi.mock('@/lib/repositories/account-members', () => ({
  createPostgresAccountMembersRepository: mocks.createRepository,
}));

import { GET } from './route';

const userId = '7d9d36e6-e4a8-4c1f-8f92-c8107c4a3d12';
const accountId = '6dd92bf4-8749-493d-914c-51a7d193cfc6';
const members = [
  {
    user_id: userId,
    full_name: 'Synthetic Member',
    email: 'member@example.test',
    avatar_url: null,
    role: 'admin' as const,
    joined_at: '2026-10-19T12:00:00.000Z',
  },
];

const accountContext = {
  userId,
  accountId,
  role: 'admin',
  account: { id: accountId, name: 'Synthetic account' },
  supabase: { from: mocks.supabaseFrom },
};

describe('GET /api/account/members PostgreSQL route', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getCurrentAccount.mockResolvedValue(accountContext);
    mocks.createRepository.mockReturnValue({ list: mocks.listMembers });
    mocks.listMembers.mockResolvedValue(members);
    mocks.supabaseFrom.mockReturnValue({
      select: vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnValue({
          order: vi.fn().mockResolvedValue({ data: [], error: null }),
        }),
      }),
    });
  });

  it('lists PostgreSQL members and preserves the response shape', async () => {
    const order: string[] = [];
    mocks.getCurrentAccount.mockImplementation(async () => {
      order.push('verified-account-context');
      return accountContext;
    });
    mocks.createRepository.mockImplementation(() => {
      order.push('postgres-repository');
      return { list: mocks.listMembers };
    });
    mocks.listMembers.mockImplementation(async () => {
      order.push('postgres-query');
      return members;
    });

    const response = await GET();

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ members });
    expect(mocks.createRepository).toHaveBeenCalledTimes(1);
    const [getVerifiedSession] = mocks.createRepository.mock.calls[0];
    await expect(getVerifiedSession()).resolves.toEqual({ userId });
    expect(mocks.supabaseFrom).not.toHaveBeenCalled();
    expect(order).toEqual([
      'verified-account-context',
      'postgres-repository',
      'postgres-query',
    ]);
  });

  it('returns the existing 401 response when the verified session is missing', async () => {
    mocks.getCurrentAccount.mockRejectedValueOnce(new UnauthorizedError());

    const response = await GET();

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({ error: 'Unauthorized' });
    expect(mocks.createRepository).not.toHaveBeenCalled();
  });

  it('maps PostgreSQL account authorization failures to 403', async () => {
    mocks.listMembers.mockRejectedValueOnce(new AppError('forbidden'));

    const response = await GET();

    expect(response.status).toBe(403);
    expect(await response.text()).not.toContain('private database detail');
  });

  it('maps PostgreSQL permission errors to 403 without exposing database text', async () => {
    mocks.listMembers.mockRejectedValueOnce({
      code: '42501',
      message: 'private database detail',
    });

    const response = await GET();

    expect(response.status).toBe(403);
    expect(await response.text()).not.toContain('private database detail');
  });

  it('keeps database failures generic', async () => {
    mocks.listMembers.mockRejectedValueOnce(
      new Error('private database detail')
    );

    const response = await GET();

    expect(response.status).toBe(500);
    const body = await response.json();
    expect(body).toEqual({
      error: 'Failed to load members',
    });
    expect(JSON.stringify(body)).not.toContain('private database detail');
  });
});
