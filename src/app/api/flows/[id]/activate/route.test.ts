import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AppError } from '@/lib/db/errors';

const mocks = vi.hoisted(() => ({
  createClient: vi.fn(),
  getUser: vi.fn(),
  supabaseFrom: vi.fn(),
  supabaseAdmin: vi.fn(),
  createRepository: vi.fn(),
  transitionForFlow: vi.fn(),
}));

vi.mock('@/lib/supabase/server', () => ({
  createClient: mocks.createClient,
}));

vi.mock('@/lib/flows/admin-client', () => ({
  supabaseAdmin: mocks.supabaseAdmin,
}));

vi.mock('@/lib/repositories/flow-status-transition', () => ({
  createPostgresFlowStatusTransitionRepository: mocks.createRepository,
}));

import { POST } from './route';

const userId = '7d9d36e6-e4a8-4c1f-8f92-c8107c4a3d12';
const flowId = '965e9639-f97f-4a92-b4a2-6f385cd1a22c';
const issues = [
  {
    code: 'missing_entry',
    message: 'Entry node is missing',
    severity: 'error',
  },
  { code: 'warning', message: 'Flow is unused', severity: 'warning' },
];

function request(body: unknown = { status: 'active' }) {
  return new Request('https://wacrm.example.test/api/flows/flow-id/activate', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

function context(id = flowId) {
  return { params: Promise.resolve({ id }) };
}

describe('POST /api/flows/[id]/activate PostgreSQL route', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, 'error').mockImplementation(() => {});
    mocks.createClient.mockResolvedValue({
      auth: { getUser: mocks.getUser },
      from: mocks.supabaseFrom,
    });
    mocks.getUser.mockResolvedValue({ data: { user: { id: userId } } });
    mocks.supabaseFrom.mockImplementation(() => {
      throw new Error('Unexpected Supabase data access');
    });
    mocks.supabaseAdmin.mockImplementation(() => {
      throw new Error('Unexpected Supabase admin access');
    });
    mocks.createRepository.mockReturnValue({
      transitionForFlow: mocks.transitionForFlow,
    });
    mocks.transitionForFlow.mockImplementation(async (id, status) => ({
      updated: true,
      flowId: id,
      status,
      issues: [],
    }));
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('rejects unauthenticated requests before creating the repository', async () => {
    mocks.getUser.mockResolvedValue({ data: { user: null } });

    const response = await POST(request(), context());

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({ error: 'Unauthorized' });
    expect(mocks.createRepository).not.toHaveBeenCalled();
  });

  it('preserves invalid-status and invalid-JSON responses', async () => {
    const invalidStatus = await POST(request({ status: 'paused' }), context());
    const invalidJson = await POST(
      new Request('https://wacrm.example.test/api/flows/flow-id/activate', {
        method: 'POST',
        body: '{',
      }),
      context()
    );

    expect(invalidStatus.status).toBe(400);
    await expect(invalidStatus.json()).resolves.toEqual({
      error: "status must be one of 'draft' | 'active' | 'archived'",
    });
    expect(invalidJson.status).toBe(400);
    expect(mocks.createRepository).not.toHaveBeenCalled();
  });

  it.each(['draft', 'active', 'archived'] as const)(
    'delegates %s status to PostgreSQL and preserves success response shape',
    async (status) => {
      const response = await POST(request({ status }), context());

      expect(response.status).toBe(200);
      await expect(response.json()).resolves.toEqual({
        flow: { id: flowId, status },
      });
      expect(mocks.createRepository).toHaveBeenCalledWith(expect.any(Function));
      await expect(mocks.createRepository.mock.calls[0][0]()).resolves.toEqual({
        userId,
      });
      expect(mocks.transitionForFlow).toHaveBeenCalledWith(flowId, status);
      expect(mocks.supabaseFrom).not.toHaveBeenCalled();
      expect(mocks.supabaseAdmin).not.toHaveBeenCalled();
    }
  );

  it('returns the full validator issue list when activation is blocked', async () => {
    mocks.transitionForFlow.mockResolvedValue({
      updated: false,
      flowId,
      status: 'draft',
      issues,
    });

    const response = await POST(request({ status: 'active' }), context());

    expect(response.status).toBe(422);
    await expect(response.json()).resolves.toEqual({
      error: 'Cannot activate flow — fix the issues below first.',
      issues,
    });
  });

  it('allows activation when validation reports warnings but no errors', async () => {
    const warning = { ...issues[1], severity: 'warning' };
    mocks.transitionForFlow.mockResolvedValue({
      updated: true,
      flowId,
      status: 'active',
      issues: [warning],
    });

    const response = await POST(request({ status: 'active' }), context());

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      flow: { id: flowId, status: 'active' },
    });
  });

  it('maps missing or cross-account flow to the existing 404 response', async () => {
    mocks.transitionForFlow.mockRejectedValue(new AppError('not_found'));

    const response = await POST(request({ status: 'draft' }), context());

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toEqual({ error: 'Not found' });
  });

  it('uses safe responses for authorization and database errors', async () => {
    mocks.transitionForFlow.mockRejectedValueOnce(new AppError('forbidden'));
    const forbidden = await POST(request(), context());
    mocks.transitionForFlow.mockRejectedValueOnce(new AppError('db_error'));
    const databaseError = await POST(request(), context());

    expect(forbidden.status).toBe(403);
    await expect(forbidden.json()).resolves.toEqual({ error: 'Forbidden' });
    expect(databaseError.status).toBe(500);
    await expect(databaseError.json()).resolves.toEqual({
      error: 'Failed to update flow status',
    });
  });
});
