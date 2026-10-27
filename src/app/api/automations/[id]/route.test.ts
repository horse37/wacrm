import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  createClient: vi.fn(),
  supabaseAdmin: vi.fn(),
  loadStepsTree: vi.fn(),
  replaceSteps: vi.fn(),
  createRepository: vi.fn(),
  patchOwnedAutomation: vi.fn(),
  createDeleteRepository: vi.fn(),
  deleteOwnedAutomation: vi.fn(),
  createEditorRepository: vi.fn(),
  getForAutomation: vi.fn(),
  activationValidationError: class extends Error {
    constructor(readonly issues: { path: string; message: string }[]) {
      super('The request is invalid.');
    }
  },
}));

vi.mock('@/lib/supabase/server', () => ({ createClient: mocks.createClient }));
vi.mock('@/lib/automations/admin-client', () => ({
  supabaseAdmin: mocks.supabaseAdmin,
}));
vi.mock('@/lib/automations/steps-tree', () => ({
  loadStepsTree: mocks.loadStepsTree,
  replaceSteps: mocks.replaceSteps,
}));
vi.mock('@/lib/repositories/automation-update-persistence', () => ({
  AutomationActivationValidationError: mocks.activationValidationError,
  createPostgresAutomationUpdatePersistenceRepository: mocks.createRepository,
}));
vi.mock('@/lib/repositories/automation-delete-persistence', () => ({
  createPostgresAutomationDeletePersistenceRepository:
    mocks.createDeleteRepository,
}));
vi.mock('@/lib/repositories/automation-editor', () => ({
  createPostgresAutomationEditorRepository: mocks.createEditorRepository,
}));

import { DELETE, GET, PATCH } from './route';
import { AppError } from '@/lib/db/errors';
import { AutomationActivationValidationError } from '@/lib/repositories/automation-update-persistence';

const automationId = '11111111-1111-4111-8111-111111111111';
const userId = '22222222-2222-4222-8222-222222222222';

function patchRequest(body: string) {
  return new Request(`http://localhost/api/automations/${automationId}`, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body,
  });
}

describe('PATCH /api/automations/[id]', () => {
  beforeEach(() => {
    mocks.createClient.mockResolvedValue({
      auth: {
        getUser: vi.fn().mockResolvedValue({ data: { user: { id: userId } } }),
      },
    });
    mocks.supabaseAdmin.mockReset();
    mocks.createRepository.mockReturnValue({
      patchOwnedAutomation: mocks.patchOwnedAutomation,
    });
    mocks.patchOwnedAutomation.mockReset().mockResolvedValue(undefined);
    mocks.createDeleteRepository.mockReturnValue({
      deleteOwnedAutomation: mocks.deleteOwnedAutomation,
    });
    mocks.deleteOwnedAutomation.mockReset().mockResolvedValue(undefined);
  });

  it('requires the existing verified server session', async () => {
    mocks.createClient.mockResolvedValue({
      auth: {
        getUser: vi.fn().mockResolvedValue({ data: { user: null } }),
      },
    });

    const response = await PATCH(patchRequest('{}'), {
      params: Promise.resolve({ id: automationId }),
    });

    expect(response.status).toBe(401);
    expect(mocks.createRepository).not.toHaveBeenCalled();
    expect(mocks.supabaseAdmin).not.toHaveBeenCalled();
  });

  it('rejects invalid JSON without touching persistence', async () => {
    const response = await PATCH(patchRequest('{'), {
      params: Promise.resolve({ id: automationId }),
    });

    expect(response.status).toBe(400);
    expect(mocks.createRepository).not.toHaveBeenCalled();
    expect(mocks.supabaseAdmin).not.toHaveBeenCalled();
  });

  it('delegates the path ID and parsed body to the PostgreSQL repository', async () => {
    const body = { name: 'Revisão', steps: [] };
    const response = await PATCH(patchRequest(JSON.stringify(body)), {
      params: Promise.resolve({ id: automationId }),
    });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true });
    expect(mocks.createRepository).toHaveBeenCalledTimes(1);
    expect(mocks.createRepository).toHaveBeenCalledWith(expect.any(Function));
    const [getVerifiedSession] = mocks.createRepository.mock.calls[0];
    await expect(getVerifiedSession()).resolves.toEqual({ userId });
    expect(mocks.patchOwnedAutomation).toHaveBeenCalledWith(automationId, body);
    expect(mocks.supabaseAdmin).not.toHaveBeenCalled();
    expect(mocks.loadStepsTree).not.toHaveBeenCalled();
    expect(mocks.replaceSteps).not.toHaveBeenCalled();
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
      mocks.patchOwnedAutomation.mockRejectedValueOnce(new AppError(code));

      const response = await PATCH(patchRequest('{}'), {
        params: Promise.resolve({ id: automationId }),
      });

      expect(response.status).toBe(status);
      expect(await response.json()).toEqual({ error: message });
      expect(mocks.supabaseAdmin).not.toHaveBeenCalled();
    }
  );

  it('preserves activation validation issues for the editor', async () => {
    const issues = [
      { path: 'steps[0].text', message: 'message text is required' },
    ];
    mocks.patchOwnedAutomation.mockRejectedValueOnce(
      new AutomationActivationValidationError(issues)
    );

    const response = await PATCH(patchRequest('{"is_active":true}'), {
      params: Promise.resolve({ id: automationId }),
    });

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      error: 'Cannot keep automation active with invalid configuration',
      issues,
    });
  });
});

describe('DELETE /api/automations/[id]', () => {
  beforeEach(() => {
    mocks.createClient.mockResolvedValue({
      auth: {
        getUser: vi.fn().mockResolvedValue({ data: { user: { id: userId } } }),
      },
    });
    mocks.supabaseAdmin.mockReset();
    mocks.createDeleteRepository.mockReset().mockReturnValue({
      deleteOwnedAutomation: mocks.deleteOwnedAutomation,
    });
    mocks.deleteOwnedAutomation.mockReset().mockResolvedValue(undefined);
  });

  it('requires the existing verified server session', async () => {
    mocks.createClient.mockResolvedValue({
      auth: {
        getUser: vi.fn().mockResolvedValue({ data: { user: null } }),
      },
    });

    const response = await DELETE(new Request('http://localhost'), {
      params: Promise.resolve({ id: automationId }),
    });

    expect(response.status).toBe(401);
    expect(mocks.createDeleteRepository).not.toHaveBeenCalled();
    expect(mocks.supabaseAdmin).not.toHaveBeenCalled();
  });

  it('delegates the path ID and verified identity to PostgreSQL', async () => {
    const response = await DELETE(new Request('http://localhost'), {
      params: Promise.resolve({ id: automationId }),
    });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true });
    expect(mocks.createDeleteRepository).toHaveBeenCalledTimes(1);
    expect(mocks.createDeleteRepository).toHaveBeenCalledWith(
      expect.any(Function)
    );
    const [getVerifiedSession] = mocks.createDeleteRepository.mock.calls[0];
    await expect(getVerifiedSession()).resolves.toEqual({ userId });
    expect(mocks.deleteOwnedAutomation).toHaveBeenCalledWith(automationId);
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
      mocks.deleteOwnedAutomation.mockRejectedValueOnce(new AppError(code));

      const response = await DELETE(new Request('http://localhost'), {
        params: Promise.resolve({ id: automationId }),
      });

      expect(response.status).toBe(status);
      expect(await response.json()).toEqual({ error: message });
      expect(mocks.supabaseAdmin).not.toHaveBeenCalled();
    }
  );
});

describe('GET /api/automations/[id]', () => {
  const editorData = {
    automation: {
      id: automationId,
      name: 'Synthetic automation',
      description: null,
      trigger_type: 'new_message_received',
      trigger_config: { keywords: ['example'] },
      is_active: false,
    },
    steps: [
      {
        id: '33333333-3333-4333-8333-333333333333',
        step_type: 'send_message',
        step_config: { text: 'Synthetic message' },
        branches: { yes: [], no: [] },
      },
    ],
  };

  beforeEach(() => {
    mocks.createClient.mockResolvedValue({
      auth: {
        getUser: vi.fn().mockResolvedValue({ data: { user: { id: userId } } }),
      },
    });
    mocks.supabaseAdmin.mockReset();
    mocks.loadStepsTree.mockReset();
    mocks.createEditorRepository.mockReset().mockReturnValue({
      getForAutomation: mocks.getForAutomation,
    });
    mocks.getForAutomation.mockReset().mockResolvedValue(editorData);
  });

  it('requires the existing verified server session', async () => {
    mocks.createClient.mockResolvedValue({
      auth: {
        getUser: vi.fn().mockResolvedValue({ data: { user: null } }),
      },
    });

    const response = await GET(new Request('http://localhost'), {
      params: Promise.resolve({ id: automationId }),
    });

    expect(response.status).toBe(401);
    expect(mocks.createEditorRepository).not.toHaveBeenCalled();
    expect(mocks.supabaseAdmin).not.toHaveBeenCalled();
  });

  it('returns the editor DTO from the PostgreSQL repository for the verified user', async () => {
    const response = await GET(new Request('http://localhost'), {
      params: Promise.resolve({ id: automationId }),
    });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(editorData);
    expect(mocks.createEditorRepository).toHaveBeenCalledTimes(1);
    expect(mocks.createEditorRepository).toHaveBeenCalledWith(
      expect.any(Function)
    );
    const [getVerifiedSession] = mocks.createEditorRepository.mock.calls[0];
    await expect(getVerifiedSession()).resolves.toEqual({ userId });
    expect(mocks.getForAutomation).toHaveBeenCalledWith(automationId);
    expect(mocks.supabaseAdmin).not.toHaveBeenCalled();
    expect(mocks.loadStepsTree).not.toHaveBeenCalled();
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
      mocks.getForAutomation.mockRejectedValueOnce(new AppError(code));

      const response = await GET(new Request('http://localhost'), {
        params: Promise.resolve({ id: automationId }),
      });

      expect(response.status).toBe(status);
      expect(await response.json()).toEqual({ error: message });
      expect(mocks.supabaseAdmin).not.toHaveBeenCalled();
      expect(mocks.loadStepsTree).not.toHaveBeenCalled();
    }
  );
});
