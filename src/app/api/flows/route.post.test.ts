import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AppError } from '@/lib/db/errors';

const mocks = vi.hoisted(() => ({
  createClient: vi.fn(),
  authenticatedFrom: vi.fn(),
  supabaseAdmin: vi.fn(),
  getFlowTemplate: vi.fn(),
  createFlowListRepository: vi.fn(),
  createFlowCreateRepository: vi.fn(),
  createDraft: vi.fn(),
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

import { POST } from './route';

const userId = '22222222-2222-4222-8222-222222222222';
const flowId = '11111111-1111-4111-8111-111111111111';

function postRequest(body: string) {
  return new Request('http://localhost/api/flows', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body,
  });
}

describe('POST /api/flows PostgreSQL route', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.createClient.mockResolvedValue({
      auth: {
        getUser: vi.fn().mockResolvedValue({ data: { user: { id: userId } } }),
      },
      from: mocks.authenticatedFrom,
    });
    mocks.createFlowCreateRepository.mockReturnValue({
      createDraft: mocks.createDraft,
    });
    mocks.createDraft.mockResolvedValue(flowId);
  });

  it('requires existing verified server session before creating repository', async () => {
    mocks.createClient.mockResolvedValue({
      auth: {
        getUser: vi.fn().mockResolvedValue({ data: { user: null } }),
      },
      from: mocks.authenticatedFrom,
    });

    const response = await POST(postRequest('{"name":"Synthetic flow"}'));

    expect(response.status).toBe(401);
    expect(mocks.createFlowCreateRepository).not.toHaveBeenCalled();
    expect(mocks.authenticatedFrom).not.toHaveBeenCalled();
    expect(mocks.supabaseAdmin).not.toHaveBeenCalled();
  });

  it('creates a plain draft through PostgreSQL using verified identity', async () => {
    const response = await POST(
      postRequest(
        JSON.stringify({
          name: 'Synthetic flow',
          trigger_type: 'keyword',
          trigger_config: { keywords: ['synthetic'] },
        })
      )
    );

    expect(response.status).toBe(201);
    expect(await response.json()).toEqual({ flow: { id: flowId } });
    expect(mocks.createFlowCreateRepository).toHaveBeenCalledTimes(1);
    const [getVerifiedSession] = mocks.createFlowCreateRepository.mock.calls[0];
    await expect(getVerifiedSession()).resolves.toEqual({ userId });
    expect(mocks.createDraft).toHaveBeenCalledWith({
      name: 'Synthetic flow',
      description: null,
      trigger_type: 'keyword',
      trigger_config: { keywords: ['synthetic'] },
    });
    expect(mocks.authenticatedFrom).not.toHaveBeenCalled();
    expect(mocks.supabaseAdmin).not.toHaveBeenCalled();
  });

  it('clones template metadata and nodes atomically through PostgreSQL', async () => {
    const template = {
      name: 'Welcome menu',
      description: 'Synthetic template',
      trigger_type: 'first_inbound_message',
      trigger_config: {},
      entry_node_id: 'start',
      nodes: [
        {
          node_key: 'start',
          node_type: 'start',
          config: { next_node_key: 'end' },
        },
        { node_key: 'end', node_type: 'end', config: {} },
      ],
    };
    mocks.getFlowTemplate.mockReturnValue(template);

    const response = await POST(
      postRequest(
        JSON.stringify({ template_slug: 'welcome_menu', name: 'Custom name' })
      )
    );

    expect(response.status).toBe(201);
    expect(await response.json()).toEqual({ flow: { id: flowId } });
    expect(mocks.createDraft).toHaveBeenCalledWith({
      name: 'Custom name',
      description: template.description,
      trigger_type: template.trigger_type,
      trigger_config: template.trigger_config,
      entry_node_id: template.entry_node_id,
      nodes: template.nodes,
    });
    expect(mocks.authenticatedFrom).not.toHaveBeenCalled();
    expect(mocks.supabaseAdmin).not.toHaveBeenCalled();
  });

  it.each([
    ['invalid JSON', '{'],
    ['missing name', JSON.stringify({ name: '   ' })],
  ])('rejects %s before persistence', async (_label, body) => {
    const response = await POST(postRequest(body));

    expect(response.status).toBe(400);
    expect(mocks.createFlowCreateRepository).not.toHaveBeenCalled();
    expect(mocks.authenticatedFrom).not.toHaveBeenCalled();
    expect(mocks.supabaseAdmin).not.toHaveBeenCalled();
  });

  it('rejects unknown templates without database access', async () => {
    mocks.getFlowTemplate.mockReturnValue(null);

    const response = await POST(
      postRequest(JSON.stringify({ template_slug: 'missing' }))
    );

    expect(response.status).toBe(400);
    expect(mocks.createFlowCreateRepository).not.toHaveBeenCalled();
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
      mocks.createDraft.mockRejectedValueOnce(new AppError(code));

      const response = await POST(
        postRequest(JSON.stringify({ name: 'Synthetic flow' }))
      );

      expect(response.status).toBe(status);
      expect(await response.json()).toEqual({ error: message });
      expect(mocks.authenticatedFrom).not.toHaveBeenCalled();
      expect(mocks.supabaseAdmin).not.toHaveBeenCalled();
    }
  );

  it('does not expose raw database errors', async () => {
    mocks.createDraft.mockRejectedValueOnce(
      new Error('synthetic private SQL detail')
    );

    const response = await POST(
      postRequest(JSON.stringify({ name: 'Synthetic flow' }))
    );

    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({
      error: 'The database operation failed.',
    });
    expect(mocks.authenticatedFrom).not.toHaveBeenCalled();
    expect(mocks.supabaseAdmin).not.toHaveBeenCalled();
  });
});
