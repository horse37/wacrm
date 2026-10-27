import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  createClient: vi.fn(),
  supabaseAdmin: vi.fn(),
  createRepository: vi.fn(),
  duplicateOwnedAutomation: vi.fn(),
}));

vi.mock('@/lib/supabase/server', () => ({ createClient: mocks.createClient }));
vi.mock('@/lib/automations/admin-client', () => ({
  supabaseAdmin: mocks.supabaseAdmin,
}));
vi.mock('@/lib/repositories/automation-duplicate-persistence', () => ({
  createPostgresAutomationDuplicatePersistenceRepository:
    mocks.createRepository,
}));

import { POST } from './route';
import { AppError } from '@/lib/db/errors';

const userId = '22222222-2222-4222-8222-222222222222';
const automationId = '11111111-1111-4111-8111-111111111111';
const duplicatedAutomation = {
  id: '33333333-3333-4333-8333-333333333333',
  user_id: userId,
  account_id: '44444444-4444-4444-8444-444444444444',
  name: 'Synthetic automation (Copy)',
  description: null,
  trigger_type: 'new_message_received',
  trigger_config: {},
  is_active: false,
  execution_count: 0,
  last_executed_at: null,
  created_at: '2026-10-20T10:00:00.000Z',
  updated_at: '2026-10-20T10:00:00.000Z',
};

describe('POST /api/automations/[id]/duplicate', () => {
  beforeEach(() => {
    mocks.createClient.mockResolvedValue({
      auth: {
        getUser: vi.fn().mockResolvedValue({ data: { user: { id: userId } } }),
      },
    });
    mocks.supabaseAdmin.mockReset();
    mocks.createRepository.mockReset().mockReturnValue({
      duplicateOwnedAutomation: mocks.duplicateOwnedAutomation,
    });
    mocks.duplicateOwnedAutomation
      .mockReset()
      .mockResolvedValue(duplicatedAutomation);
  });

  it('requires the existing verified server session', async () => {
    mocks.createClient.mockResolvedValue({
      auth: {
        getUser: vi.fn().mockResolvedValue({ data: { user: null } }),
      },
    });

    const response = await POST(new Request('http://localhost'), {
      params: Promise.resolve({ id: automationId }),
    });

    expect(response.status).toBe(401);
    expect(mocks.createRepository).not.toHaveBeenCalled();
    expect(mocks.supabaseAdmin).not.toHaveBeenCalled();
  });

  it('duplicates through PostgreSQL using verified identity and path ID', async () => {
    const response = await POST(new Request('http://localhost'), {
      params: Promise.resolve({ id: automationId }),
    });

    expect(response.status).toBe(201);
    expect(await response.json()).toEqual({ automation: duplicatedAutomation });
    expect(mocks.createRepository).toHaveBeenCalledTimes(1);
    expect(mocks.createRepository).toHaveBeenCalledWith(expect.any(Function));
    const [getVerifiedSession] = mocks.createRepository.mock.calls[0];
    await expect(getVerifiedSession()).resolves.toEqual({ userId });
    expect(mocks.duplicateOwnedAutomation).toHaveBeenCalledWith(automationId);
    expect(mocks.supabaseAdmin).not.toHaveBeenCalled();
  });

  it.each([
    ['unauthorized', 401, 'Authentication is required.'],
    ['forbidden', 403, 'The operation is not allowed.'],
    ['bad_request', 400, 'The request is invalid.'],
    ['not_found', 404, 'The requested resource was not found.'],
    ['conflict', 409, 'The operation conflicts with existing data.'],
    ['db_error', 500, 'The database operation failed.'],
  ] as const)(
    'maps repository %s errors to safe HTTP statuses and messages',
    async (code, status, message) => {
      mocks.duplicateOwnedAutomation.mockRejectedValueOnce(new AppError(code));

      const response = await POST(new Request('http://localhost'), {
        params: Promise.resolve({ id: automationId }),
      });

      expect(response.status).toBe(status);
      expect(await response.json()).toEqual({ error: message });
      expect(mocks.supabaseAdmin).not.toHaveBeenCalled();
    }
  );
});
