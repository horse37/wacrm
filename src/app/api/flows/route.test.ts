import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AppError } from '@/lib/db/errors';

const mocks = vi.hoisted(() => ({
  createClient: vi.fn(),
  authenticatedFrom: vi.fn(),
  supabaseAdmin: vi.fn(),
  getFlowTemplate: vi.fn(),
  createFlowListRepository: vi.fn(),
  listForCurrentAccount: vi.fn(),
  createFlowCreateRepository: vi.fn(),
}));

vi.mock('@/lib/supabase/server', () => ({ createClient: mocks.createClient }));
vi.mock('@/lib/flows/admin-client', () => ({
  supabaseAdmin: mocks.supabaseAdmin,
}));
vi.mock('@/lib/flows/templates', () => ({
  getFlowTemplate: mocks.getFlowTemplate,
}));
vi.mock('@/lib/repositories/flow-list', () => ({
  createPostgresFlowListRepository: mocks.createFlowListRepository,
}));
vi.mock('@/lib/repositories/flow-create-persistence', () => ({
  createPostgresFlowCreatePersistenceRepository:
    mocks.createFlowCreateRepository,
}));

import { GET } from './route';

const userId = '22222222-2222-4222-8222-222222222222';
const flowId = '11111111-1111-4111-8111-111111111111';
const listedFlows = [
  {
    id: flowId,
    name: 'Synthetic flow',
    description: null,
    status: 'active',
    trigger_type: 'keyword',
    trigger_config: { keywords: ['synthetic'] },
    execution_count: 2,
  },
];

function setupLegacyQuery(result: { data: unknown; error: unknown }) {
  const query = {
    select: vi.fn(),
    order: vi.fn().mockResolvedValue(result),
  };
  query.select.mockReturnValue(query);
  mocks.authenticatedFrom.mockReturnValue(query);
}

describe('GET /api/flows', () => {
  beforeEach(() => {
    mocks.createClient.mockReset().mockResolvedValue({
      auth: {
        getUser: vi.fn().mockResolvedValue({ data: { user: { id: userId } } }),
      },
      from: mocks.authenticatedFrom,
    });
    mocks.authenticatedFrom.mockReset();
    setupLegacyQuery({ data: [], error: null });
    mocks.supabaseAdmin.mockReset();
    mocks.getFlowTemplate.mockReset();
    mocks.createFlowListRepository.mockReset().mockReturnValue({
      listForCurrentAccount: mocks.listForCurrentAccount,
    });
    mocks.listForCurrentAccount.mockReset().mockResolvedValue(listedFlows);
  });

  it('requires the existing verified server session', async () => {
    mocks.createClient.mockResolvedValue({
      auth: {
        getUser: vi.fn().mockResolvedValue({ data: { user: null } }),
      },
      from: mocks.authenticatedFrom,
    });

    const response = await GET();

    expect(response.status).toBe(401);
    expect(mocks.createFlowListRepository).not.toHaveBeenCalled();
    expect(mocks.authenticatedFrom).not.toHaveBeenCalled();
    expect(mocks.supabaseAdmin).not.toHaveBeenCalled();
  });

  it('lists through PostgreSQL using the verified session identity', async () => {
    const response = await GET();

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ flows: listedFlows });
    expect(mocks.createFlowListRepository).toHaveBeenCalledTimes(1);
    expect(mocks.createFlowListRepository).toHaveBeenCalledWith(
      expect.any(Function)
    );
    const [getVerifiedSession] = mocks.createFlowListRepository.mock.calls[0];
    await expect(getVerifiedSession()).resolves.toEqual({ userId });
    expect(mocks.listForCurrentAccount).toHaveBeenCalledTimes(1);
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
    'maps repository %s errors to safe HTTP status and message',
    async (code, status, message) => {
      mocks.listForCurrentAccount.mockRejectedValueOnce(new AppError(code));

      const response = await GET();

      expect(response.status).toBe(status);
      expect(await response.json()).toEqual({ error: message });
      expect(mocks.authenticatedFrom).not.toHaveBeenCalled();
      expect(mocks.supabaseAdmin).not.toHaveBeenCalled();
    }
  );

  it('does not expose raw database errors', async () => {
    mocks.listForCurrentAccount.mockRejectedValueOnce(
      new Error('synthetic private SQL detail')
    );

    const response = await GET();

    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({
      error: 'The database operation failed.',
    });
    expect(mocks.authenticatedFrom).not.toHaveBeenCalled();
    expect(mocks.supabaseAdmin).not.toHaveBeenCalled();
  });
});
