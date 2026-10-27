import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AppError } from '@/lib/db/errors';

const mocks = vi.hoisted(() => ({
  createClient: vi.fn(),
  createAdminClient: vi.fn(),
  legacyFrom: vi.fn(),
  createRepository: vi.fn(),
  deleteConnectionConfig: vi.fn(),
}));

vi.mock('@/lib/supabase/server', () => ({
  createClient: mocks.createClient,
}));
vi.mock('@supabase/supabase-js', () => ({
  createClient: mocks.createAdminClient,
}));
vi.mock('@/lib/repositories/whatsapp-config', () => ({
  createPostgresWhatsAppConfigRepository: mocks.createRepository,
}));

import { DELETE } from './route';

const userId = '00000000-0000-4000-8000-000000000001';

describe('DELETE /api/whatsapp/config', () => {
  beforeEach(() => {
    mocks.createClient.mockReset().mockResolvedValue({
      auth: {
        getUser: vi.fn().mockResolvedValue({
          data: { user: { id: userId } },
          error: null,
        }),
      },
      from: mocks.legacyFrom,
    });
    mocks.createAdminClient.mockReset();
    mocks.legacyFrom.mockReset();
    mocks.createRepository.mockReset().mockReturnValue({
      deleteConnectionConfig: mocks.deleteConnectionConfig,
    });
    mocks.deleteConnectionConfig.mockReset().mockResolvedValue(undefined);
  });

  it('requires a verified server session before opening the repository', async () => {
    mocks.createClient.mockResolvedValueOnce({
      auth: {
        getUser: vi.fn().mockResolvedValue({
          data: { user: null },
          error: null,
        }),
      },
      from: mocks.legacyFrom,
    });

    const response = await DELETE();

    expect(response.status).toBe(401);
    expect(mocks.createRepository).not.toHaveBeenCalled();
    expect(mocks.legacyFrom).not.toHaveBeenCalled();
    expect(mocks.createAdminClient).not.toHaveBeenCalled();
  });

  it('deletes only through the PostgreSQL repository using verified identity', async () => {
    const response = await DELETE();

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ success: true });
    expect(mocks.createRepository).toHaveBeenCalledTimes(1);
    const [getVerifiedSession] = mocks.createRepository.mock.calls[0];
    await expect(getVerifiedSession()).resolves.toEqual({ userId });
    expect(mocks.deleteConnectionConfig).toHaveBeenCalledOnce();
    expect(mocks.legacyFrom).not.toHaveBeenCalled();
    expect(mocks.createAdminClient).not.toHaveBeenCalled();
  });

  it('returns forbidden for non-admin membership without exposing DB details', async () => {
    mocks.deleteConnectionConfig.mockRejectedValueOnce(
      new AppError('forbidden')
    );

    const response = await DELETE();

    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ error: 'Forbidden' });
    expect(mocks.legacyFrom).not.toHaveBeenCalled();
    expect(mocks.createAdminClient).not.toHaveBeenCalled();
  });

  it('returns a safe database failure response', async () => {
    const consoleError = vi
      .spyOn(console, 'error')
      .mockImplementation(() => {});
    mocks.deleteConnectionConfig.mockRejectedValueOnce(
      new AppError('db_error')
    );

    const response = await DELETE();

    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({
      error: 'Failed to delete configuration',
    });
    expect(consoleError).toHaveBeenCalledOnce();
    expect(mocks.legacyFrom).not.toHaveBeenCalled();
    expect(mocks.createAdminClient).not.toHaveBeenCalled();
  });
});
