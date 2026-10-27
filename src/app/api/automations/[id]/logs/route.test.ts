import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  createClient: vi.fn(),
  authenticatedFrom: vi.fn(),
  supabaseAdmin: vi.fn(),
  createRepository: vi.fn(),
  listForAutomation: vi.fn(),
}));

vi.mock('@/lib/supabase/server', () => ({ createClient: mocks.createClient }));
vi.mock('@/lib/automations/admin-client', () => ({
  supabaseAdmin: mocks.supabaseAdmin,
}));
vi.mock('@/lib/repositories/automation-logs', () => ({
  createPostgresAutomationLogsRepository: mocks.createRepository,
}));

import { GET } from './route';
import { AppError } from '@/lib/db/errors';

const userId = '22222222-2222-4222-8222-222222222222';
const automationId = '11111111-1111-4111-8111-111111111111';
const logsList = {
  automation: { id: automationId, name: 'Synthetic automation' },
  logs: [
    {
      id: '33333333-3333-4333-8333-333333333333',
      trigger_event: 'synthetic event',
      steps_executed: [
        { step_type: 'send_message', status: 'success' as const },
      ],
      status: 'success' as const,
      error_message: null,
      created_at: '2026-10-20T10:00:00.000Z',
      contact: { name: 'Synthetic contact', phone: '+15550000000' },
    },
  ],
};

describe('GET /api/automations/[id]/logs', () => {
  beforeEach(() => {
    mocks.createClient.mockResolvedValue({
      auth: {
        getUser: vi.fn().mockResolvedValue({ data: { user: { id: userId } } }),
      },
      from: mocks.authenticatedFrom,
    });
    mocks.authenticatedFrom.mockReset();
    mocks.supabaseAdmin.mockReset();
    mocks.createRepository.mockReset().mockReturnValue({
      listForAutomation: mocks.listForAutomation,
    });
    mocks.listForAutomation.mockReset().mockResolvedValue(logsList);
  });

  it('requires the existing verified server session', async () => {
    mocks.createClient.mockResolvedValue({
      auth: {
        getUser: vi.fn().mockResolvedValue({ data: { user: null } }),
      },
      from: mocks.authenticatedFrom,
    });

    const response = await GET(new Request('http://localhost'), {
      params: Promise.resolve({ id: automationId }),
    });

    expect(response.status).toBe(401);
    expect(mocks.createRepository).not.toHaveBeenCalled();
    expect(mocks.authenticatedFrom).not.toHaveBeenCalled();
    expect(mocks.supabaseAdmin).not.toHaveBeenCalled();
  });

  it('returns automation logs through PostgreSQL with verified identity and path ID', async () => {
    const response = await GET(new Request('http://localhost'), {
      params: Promise.resolve({ id: automationId }),
    });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(logsList);
    expect(mocks.createRepository).toHaveBeenCalledTimes(1);
    expect(mocks.createRepository).toHaveBeenCalledWith(expect.any(Function));
    const [getVerifiedSession] = mocks.createRepository.mock.calls[0];
    await expect(getVerifiedSession()).resolves.toEqual({ userId });
    expect(mocks.listForAutomation).toHaveBeenCalledWith(automationId);
    expect(mocks.authenticatedFrom).not.toHaveBeenCalled();
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
      mocks.listForAutomation.mockRejectedValueOnce(new AppError(code));

      const response = await GET(new Request('http://localhost'), {
        params: Promise.resolve({ id: automationId }),
      });

      expect(response.status).toBe(status);
      expect(await response.json()).toEqual({ error: message });
      expect(mocks.authenticatedFrom).not.toHaveBeenCalled();
      expect(mocks.supabaseAdmin).not.toHaveBeenCalled();
    }
  );
});
