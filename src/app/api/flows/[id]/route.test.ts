import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AppError } from '@/lib/db/errors';

const mocks = vi.hoisted(() => ({
  createClient: vi.fn(),
  authenticatedFrom: vi.fn(),
  supabaseAdmin: vi.fn(),
  createFlowEditorLoadRepository: vi.fn(),
  getForFlow: vi.fn(),
  createFlowHeaderUpdateRepository: vi.fn(),
  updateForFlow: vi.fn(),
  createFlowNodeGraphReplaceRepository: vi.fn(),
  replaceForFlow: vi.fn(),
  createFlowDeleteRepository: vi.fn(),
  deleteOwnedFlow: vi.fn(),
}));

vi.mock('@/lib/supabase/server', () => ({
  createClient: mocks.createClient,
}));
vi.mock('@/lib/flows/admin-client', () => ({
  supabaseAdmin: mocks.supabaseAdmin,
}));
vi.mock('@/lib/repositories/flow-editor-load', () => ({
  createPostgresFlowEditorLoadRepository: mocks.createFlowEditorLoadRepository,
}));
vi.mock('@/lib/repositories/flow-header-update', () => ({
  createPostgresFlowHeaderUpdateRepository:
    mocks.createFlowHeaderUpdateRepository,
}));
vi.mock('@/lib/repositories/flow-node-graph-replace', () => ({
  createPostgresFlowNodeGraphReplaceRepository:
    mocks.createFlowNodeGraphReplaceRepository,
}));
vi.mock('@/lib/repositories/flow-delete-persistence', () => ({
  createPostgresFlowDeletePersistenceRepository:
    mocks.createFlowDeleteRepository,
}));

import { DELETE, GET, PUT } from './route';

const userId = '22222222-2222-4222-8222-222222222222';
const flowId = '11111111-1111-4111-8111-111111111111';
const editorData = {
  flow: {
    id: flowId,
    name: 'Synthetic flow',
    description: null,
    status: 'draft',
    trigger_type: 'keyword',
    trigger_config: { keywords: ['synthetic'] },
    entry_node_id: 'start',
  },
  nodes: [
    {
      node_key: 'start',
      node_type: 'start',
      config: { next_node_key: 'end' },
      position_x: 0,
      position_y: 0,
    },
  ],
};

async function getFlow() {
  return GET(new Request(`http://localhost/api/flows/${flowId}`), {
    params: Promise.resolve({ id: flowId }),
  });
}

describe('GET /api/flows/[id]', () => {
  beforeEach(() => {
    const legacyQuery = {
      select: vi.fn(),
      eq: vi.fn(),
      maybeSingle: vi.fn().mockResolvedValue({ data: { id: flowId } }),
      order: vi.fn().mockResolvedValue({ data: [] }),
    };
    legacyQuery.select.mockReturnValue(legacyQuery);
    legacyQuery.eq.mockReturnValue(legacyQuery);
    mocks.createClient.mockReset().mockResolvedValue({
      auth: {
        getUser: vi.fn().mockResolvedValue({ data: { user: { id: userId } } }),
      },
      from: mocks.authenticatedFrom,
    });
    mocks.authenticatedFrom.mockReset().mockReturnValue(legacyQuery);
    mocks.supabaseAdmin.mockReset();
    mocks.createFlowEditorLoadRepository.mockReset().mockReturnValue({
      getForFlow: mocks.getForFlow,
    });
    mocks.getForFlow.mockReset().mockResolvedValue(editorData);
    mocks.createFlowHeaderUpdateRepository.mockReset().mockReturnValue({
      updateForFlow: mocks.updateForFlow,
    });
    mocks.updateForFlow.mockReset().mockResolvedValue(undefined);
    mocks.createFlowNodeGraphReplaceRepository.mockReset().mockReturnValue({
      replaceForFlow: mocks.replaceForFlow,
    });
    mocks.replaceForFlow.mockReset().mockResolvedValue(undefined);
  });

  it('requires the existing verified server session', async () => {
    mocks.createClient.mockResolvedValue({
      auth: {
        getUser: vi.fn().mockResolvedValue({ data: { user: null } }),
      },
      from: mocks.authenticatedFrom,
    });

    const response = await getFlow();

    expect(response.status).toBe(401);
    expect(mocks.createFlowEditorLoadRepository).not.toHaveBeenCalled();
    expect(mocks.authenticatedFrom).not.toHaveBeenCalled();
    expect(mocks.supabaseAdmin).not.toHaveBeenCalled();
  });

  it('loads editor DTO from PostgreSQL using verified session identity', async () => {
    const response = await getFlow();

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(editorData);
    expect(mocks.createFlowEditorLoadRepository).toHaveBeenCalledTimes(1);
    expect(mocks.createFlowEditorLoadRepository).toHaveBeenCalledWith(
      expect.any(Function)
    );
    const [getVerifiedSession] =
      mocks.createFlowEditorLoadRepository.mock.calls[0];
    await expect(getVerifiedSession()).resolves.toEqual({ userId });
    expect(mocks.getForFlow).toHaveBeenCalledExactlyOnceWith(flowId);
    expect(mocks.authenticatedFrom).not.toHaveBeenCalled();
    expect(mocks.supabaseAdmin).not.toHaveBeenCalled();
  });

  it.each([
    ['not_found', 404, 'The requested resource was not found.'],
    ['db_error', 500, 'The database operation failed.'],
  ] as const)(
    'maps repository %s errors to safe HTTP status and message',
    async (code, status, message) => {
      mocks.getForFlow.mockRejectedValueOnce(new AppError(code));

      const response = await getFlow();

      expect(response.status).toBe(status);
      expect(await response.json()).toEqual({ error: message });
      expect(mocks.authenticatedFrom).not.toHaveBeenCalled();
      expect(mocks.supabaseAdmin).not.toHaveBeenCalled();
    }
  );

  it('does not expose raw repository errors', async () => {
    mocks.getForFlow.mockRejectedValueOnce(
      new Error('synthetic private SQL detail')
    );

    const response = await getFlow();

    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({
      error: 'The database operation failed.',
    });
    expect(mocks.authenticatedFrom).not.toHaveBeenCalled();
    expect(mocks.supabaseAdmin).not.toHaveBeenCalled();
  });
});

function putFlow(body: string | unknown) {
  return PUT(
    new Request(`http://localhost/api/flows/${flowId}`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: typeof body === 'string' ? body : JSON.stringify(body),
    }),
    { params: Promise.resolve({ id: flowId }) }
  );
}

describe('PUT /api/flows/[id]', () => {
  beforeEach(() => {
    mocks.createClient.mockReset().mockResolvedValue({
      auth: {
        getUser: vi.fn().mockResolvedValue({ data: { user: { id: userId } } }),
      },
      from: mocks.authenticatedFrom,
    });
    mocks.authenticatedFrom.mockReset();
    mocks.supabaseAdmin.mockReset();
    mocks.createFlowHeaderUpdateRepository.mockReset().mockReturnValue({
      updateForFlow: mocks.updateForFlow,
    });
    mocks.updateForFlow.mockReset().mockResolvedValue(undefined);
    mocks.createFlowNodeGraphReplaceRepository.mockReset().mockReturnValue({
      replaceForFlow: mocks.replaceForFlow,
    });
    mocks.replaceForFlow.mockReset().mockResolvedValue(undefined);
    mocks.createFlowEditorLoadRepository.mockReset().mockReturnValue({
      getForFlow: mocks.getForFlow,
    });
    mocks.getForFlow.mockReset().mockResolvedValue(editorData);
  });

  it('updates headers in PostgreSQL and returns the editor DTO', async () => {
    const response = await putFlow({ name: ' Updated ', description: null });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(editorData);
    expect(mocks.createFlowHeaderUpdateRepository).toHaveBeenCalledTimes(1);
    expect(mocks.updateForFlow).toHaveBeenCalledExactlyOnceWith(flowId, {
      name: 'Updated',
      description: null,
    });
    expect(mocks.createFlowNodeGraphReplaceRepository).not.toHaveBeenCalled();
    expect(mocks.getForFlow).toHaveBeenCalledExactlyOnceWith(flowId);
    expect(mocks.authenticatedFrom).not.toHaveBeenCalled();
    expect(mocks.supabaseAdmin).not.toHaveBeenCalled();
  });

  it('replaces graph in PostgreSQL when nodes are supplied', async () => {
    const nodes = [
      {
        node_key: 'start',
        node_type: 'start',
        config: { next_node_key: 'end' },
      },
    ];

    const response = await putFlow({ name: 'Updated', nodes });

    expect(response.status).toBe(200);
    expect(mocks.updateForFlow).toHaveBeenCalledExactlyOnceWith(flowId, {
      name: 'Updated',
    });
    expect(mocks.createFlowNodeGraphReplaceRepository).toHaveBeenCalledTimes(1);
    expect(mocks.replaceForFlow).toHaveBeenCalledExactlyOnceWith(flowId, nodes);
    expect(mocks.getForFlow).toHaveBeenCalledExactlyOnceWith(flowId);
    expect(mocks.authenticatedFrom).not.toHaveBeenCalled();
    expect(mocks.supabaseAdmin).not.toHaveBeenCalled();
  });

  it('requires a verified session before repositories or data access', async () => {
    mocks.createClient.mockResolvedValue({
      auth: {
        getUser: vi.fn().mockResolvedValue({ data: { user: null } }),
      },
      from: mocks.authenticatedFrom,
    });

    const response = await putFlow({ name: 'Updated' });

    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: 'Unauthorized' });
    expect(mocks.createFlowHeaderUpdateRepository).not.toHaveBeenCalled();
    expect(mocks.createFlowNodeGraphReplaceRepository).not.toHaveBeenCalled();
    expect(mocks.createFlowEditorLoadRepository).not.toHaveBeenCalled();
    expect(mocks.authenticatedFrom).not.toHaveBeenCalled();
    expect(mocks.supabaseAdmin).not.toHaveBeenCalled();
  });

  it('maps repository errors to safe HTTP status and message', async () => {
    mocks.updateForFlow.mockRejectedValueOnce(new AppError('not_found'));

    const response = await putFlow({ name: 'Updated' });

    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({
      error: 'The requested resource was not found.',
    });
    expect(mocks.getForFlow).not.toHaveBeenCalled();
    expect(mocks.authenticatedFrom).not.toHaveBeenCalled();
    expect(mocks.supabaseAdmin).not.toHaveBeenCalled();
  });

  it('rejects an empty flow name before repository writes', async () => {
    const response = await putFlow({ name: '   ' });

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: 'name cannot be empty' });
    expect(mocks.createFlowHeaderUpdateRepository).not.toHaveBeenCalled();
    expect(mocks.createFlowNodeGraphReplaceRepository).not.toHaveBeenCalled();
    expect(mocks.supabaseAdmin).not.toHaveBeenCalled();
  });

  it('rejects invalid JSON before calling data repositories', async () => {
    const response = await putFlow('{');

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: 'Invalid JSON' });
    expect(mocks.createFlowHeaderUpdateRepository).not.toHaveBeenCalled();
    expect(mocks.createFlowNodeGraphReplaceRepository).not.toHaveBeenCalled();
    expect(mocks.authenticatedFrom).not.toHaveBeenCalled();
    expect(mocks.supabaseAdmin).not.toHaveBeenCalled();
  });
});

function deleteFlow() {
  return DELETE(new Request(`http://localhost/api/flows/${flowId}`), {
    params: Promise.resolve({ id: flowId }),
  });
}

describe('DELETE /api/flows/[id]', () => {
  beforeEach(() => {
    mocks.createClient.mockReset().mockResolvedValue({
      auth: {
        getUser: vi.fn().mockResolvedValue({ data: { user: { id: userId } } }),
      },
      from: mocks.authenticatedFrom,
    });
    mocks.authenticatedFrom.mockReset();
    mocks.supabaseAdmin.mockReset();
    mocks.createFlowDeleteRepository.mockReset().mockReturnValue({
      deleteOwnedFlow: mocks.deleteOwnedFlow,
    });
    mocks.deleteOwnedFlow.mockReset().mockResolvedValue(undefined);
  });

  it('deletes through PostgreSQL and preserves success response', async () => {
    const response = await deleteFlow();

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true });
    expect(mocks.createFlowDeleteRepository).toHaveBeenCalledTimes(1);
    expect(mocks.deleteOwnedFlow).toHaveBeenCalledExactlyOnceWith(flowId);
    const [getVerifiedSession] = mocks.createFlowDeleteRepository.mock.calls[0];
    await expect(getVerifiedSession()).resolves.toEqual({ userId });
    expect(mocks.authenticatedFrom).not.toHaveBeenCalled();
    expect(mocks.supabaseAdmin).not.toHaveBeenCalled();
  });

  it('requires verified session before repository or data access', async () => {
    mocks.createClient.mockResolvedValue({
      auth: {
        getUser: vi.fn().mockResolvedValue({ data: { user: null } }),
      },
      from: mocks.authenticatedFrom,
    });

    const response = await deleteFlow();

    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: 'Unauthorized' });
    expect(mocks.createFlowDeleteRepository).not.toHaveBeenCalled();
    expect(mocks.authenticatedFrom).not.toHaveBeenCalled();
    expect(mocks.supabaseAdmin).not.toHaveBeenCalled();
  });

  it.each([
    ['forbidden', 403, 'The operation is not allowed.'],
    ['not_found', 404, 'The requested resource was not found.'],
    ['db_error', 500, 'The database operation failed.'],
  ] as const)(
    'maps repository %s errors to safe HTTP status and message',
    async (code, status, message) => {
      mocks.deleteOwnedFlow.mockRejectedValueOnce(new AppError(code));

      const response = await deleteFlow();

      expect(response.status).toBe(status);
      expect(await response.json()).toEqual({ error: message });
      expect(mocks.authenticatedFrom).not.toHaveBeenCalled();
      expect(mocks.supabaseAdmin).not.toHaveBeenCalled();
    }
  );

  it('does not expose raw repository errors', async () => {
    mocks.deleteOwnedFlow.mockRejectedValueOnce(
      new Error('synthetic private database detail')
    );

    const response = await deleteFlow();

    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({
      error: 'The database operation failed.',
    });
    expect(mocks.authenticatedFrom).not.toHaveBeenCalled();
    expect(mocks.supabaseAdmin).not.toHaveBeenCalled();
  });
});
