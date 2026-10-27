import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  createClient: vi.fn(),
  authenticatedFrom: vi.fn(),
  supabaseAdmin: vi.fn(),
  adminFrom: vi.fn(),
  insertSteps: vi.fn(),
  getTemplate: vi.fn(),
  createRepository: vi.fn(),
  createAutomation: vi.fn(),
  createListRepository: vi.fn(),
  listForCurrentAccount: vi.fn(),
  validateStepsForActivation: vi.fn(),
  validateTriggerForActivation: vi.fn(),
}));

vi.mock('@/lib/supabase/server', () => ({ createClient: mocks.createClient }));
vi.mock('@/lib/automations/admin-client', () => ({
  supabaseAdmin: mocks.supabaseAdmin,
}));
vi.mock('@/lib/automations/templates', () => ({
  getTemplate: mocks.getTemplate,
}));
vi.mock('@/lib/automations/steps-tree', () => ({
  insertSteps: mocks.insertSteps,
}));
vi.mock('@/lib/automations/validate', () => ({
  validateStepsForActivation: mocks.validateStepsForActivation,
  validateTriggerForActivation: mocks.validateTriggerForActivation,
}));
vi.mock('@/lib/repositories/automation-create-persistence', () => ({
  createPostgresAutomationCreatePersistenceRepository: mocks.createRepository,
}));
vi.mock('@/lib/repositories/automation-list', () => ({
  createPostgresAutomationListRepository: mocks.createListRepository,
}));

import { GET, POST } from './route';
import { AppError } from '@/lib/db/errors';

const userId = '22222222-2222-4222-8222-222222222222';
const accountId = '33333333-3333-4333-8333-333333333333';
const automationId = '11111111-1111-4111-8111-111111111111';
const steps = [
  { step_type: 'send_message', step_config: { text: 'Synthetic message' } },
];
const createdAutomation = {
  id: automationId,
  user_id: userId,
  account_id: accountId,
  name: 'Synthetic automation',
  description: null,
  trigger_type: 'new_message_received',
  trigger_config: {},
  is_active: false,
  execution_count: 0,
  last_executed_at: null,
  created_at: '2026-10-20T10:00:00.000Z',
  updated_at: '2026-10-20T10:00:00.000Z',
};
const listedAutomations = [
  {
    id: automationId,
    name: 'Synthetic automation',
    description: null,
    trigger_type: 'new_message_received',
    is_active: false,
    execution_count: 0,
    last_executed_at: null,
  },
];

describe('GET /api/automations', () => {
  beforeEach(() => {
    mocks.createClient.mockResolvedValue({
      auth: {
        getUser: vi.fn().mockResolvedValue({ data: { user: { id: userId } } }),
      },
      from: mocks.authenticatedFrom,
    });
    mocks.authenticatedFrom.mockReset();
    mocks.supabaseAdmin.mockReset();
    mocks.createListRepository.mockReset().mockReturnValue({
      listForCurrentAccount: mocks.listForCurrentAccount,
    });
    mocks.listForCurrentAccount
      .mockReset()
      .mockResolvedValue(listedAutomations);
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
    expect(mocks.createListRepository).not.toHaveBeenCalled();
    expect(mocks.authenticatedFrom).not.toHaveBeenCalled();
    expect(mocks.supabaseAdmin).not.toHaveBeenCalled();
  });

  it('lists through PostgreSQL using the verified session identity', async () => {
    const response = await GET();

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ automations: listedAutomations });
    expect(mocks.createListRepository).toHaveBeenCalledTimes(1);
    expect(mocks.createListRepository).toHaveBeenCalledWith(
      expect.any(Function)
    );
    const [getVerifiedSession] = mocks.createListRepository.mock.calls[0];
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
    'maps repository %s errors to safe HTTP statuses and messages',
    async (code, status, message) => {
      mocks.listForCurrentAccount.mockRejectedValueOnce(new AppError(code));

      const response = await GET();

      expect(response.status).toBe(status);
      expect(await response.json()).toEqual({ error: message });
      expect(mocks.authenticatedFrom).not.toHaveBeenCalled();
      expect(mocks.supabaseAdmin).not.toHaveBeenCalled();
    }
  );
});

function postRequest(body: string) {
  return new Request('http://localhost/api/automations', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body,
  });
}

function setupLegacySupabaseMocks() {
  const profileQuery = {
    select: vi.fn(),
    eq: vi.fn(),
    single: vi.fn().mockResolvedValue({ data: { account_id: accountId } }),
  };
  profileQuery.select.mockReturnValue(profileQuery);
  profileQuery.eq.mockReturnValue(profileQuery);
  mocks.authenticatedFrom.mockReturnValue(profileQuery);

  const insertQuery = {
    insert: vi.fn(),
    select: vi.fn(),
    single: vi.fn().mockResolvedValue({
      data: createdAutomation,
      error: null,
    }),
  };
  insertQuery.insert.mockReturnValue(insertQuery);
  insertQuery.select.mockReturnValue(insertQuery);
  mocks.adminFrom.mockReturnValue(insertQuery);
  mocks.supabaseAdmin.mockReturnValue({ from: mocks.adminFrom });
}

describe('POST /api/automations', () => {
  beforeEach(() => {
    mocks.createClient.mockResolvedValue({
      auth: {
        getUser: vi.fn().mockResolvedValue({ data: { user: { id: userId } } }),
      },
      from: mocks.authenticatedFrom,
    });
    mocks.authenticatedFrom.mockReset();
    mocks.supabaseAdmin.mockReset();
    mocks.adminFrom.mockReset();
    mocks.insertSteps.mockReset().mockResolvedValue(null);
    mocks.getTemplate.mockReset().mockReturnValue(undefined);
    mocks.createRepository.mockReset().mockReturnValue({
      createAutomation: mocks.createAutomation,
    });
    mocks.createAutomation.mockReset().mockResolvedValue(createdAutomation);
    mocks.validateStepsForActivation.mockReset().mockReturnValue([]);
    mocks.validateTriggerForActivation.mockReset().mockReturnValue([]);
    setupLegacySupabaseMocks();
  });

  it('requires the existing verified server session', async () => {
    mocks.createClient.mockResolvedValue({
      auth: {
        getUser: vi.fn().mockResolvedValue({ data: { user: null } }),
      },
      from: mocks.authenticatedFrom,
    });

    const response = await POST(
      postRequest(JSON.stringify({ name: 'Synthetic', trigger_type: 'manual' }))
    );

    expect(response.status).toBe(401);
    expect(mocks.createRepository).not.toHaveBeenCalled();
    expect(mocks.authenticatedFrom).not.toHaveBeenCalled();
    expect(mocks.supabaseAdmin).not.toHaveBeenCalled();
  });

  it('rejects invalid JSON without touching persistence', async () => {
    const response = await POST(postRequest('{'));

    expect(response.status).toBe(400);
    expect(mocks.createRepository).not.toHaveBeenCalled();
    expect(mocks.authenticatedFrom).not.toHaveBeenCalled();
    expect(mocks.supabaseAdmin).not.toHaveBeenCalled();
  });

  it('requires a name and trigger type', async () => {
    const response = await POST(postRequest(JSON.stringify({ name: '' })));

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      error: 'name and trigger_type are required',
    });
    expect(mocks.createRepository).not.toHaveBeenCalled();
  });

  it('resolves a static template into repository input', async () => {
    const templateSteps = [
      {
        step_type: 'send_message',
        step_config: { text: 'Template greeting' },
      },
    ];
    mocks.getTemplate.mockReturnValueOnce({
      name: 'Template automation',
      description: 'Template description',
      trigger_type: 'new_message_received',
      trigger_config: { keywords: ['hello'] },
      steps: templateSteps,
    });

    const response = await POST(
      postRequest(JSON.stringify({ template: 'welcome' }))
    );

    expect(response.status).toBe(201);
    expect(await response.json()).toEqual({ automation: createdAutomation });
    expect(mocks.getTemplate).toHaveBeenCalledWith('welcome');
    expect(mocks.createAutomation).toHaveBeenCalledWith({
      name: 'Template automation',
      description: 'Template description',
      trigger_type: 'new_message_received',
      trigger_config: { keywords: ['hello'] },
      is_active: false,
      steps: templateSteps,
    });
    const [getVerifiedSession] = mocks.createRepository.mock.calls[0];
    await expect(getVerifiedSession()).resolves.toEqual({ userId });
    expect(mocks.authenticatedFrom).not.toHaveBeenCalled();
    expect(mocks.supabaseAdmin).not.toHaveBeenCalled();
    expect(mocks.insertSteps).not.toHaveBeenCalled();
  });

  it('preserves activation validation issues and does not persist invalid active input', async () => {
    const issues = [
      { path: 'steps[0].text', message: 'message text is required' },
    ];
    mocks.validateTriggerForActivation.mockReturnValueOnce([]);
    mocks.validateStepsForActivation.mockReturnValueOnce(issues);

    const response = await POST(
      postRequest(
        JSON.stringify({
          name: 'Synthetic automation',
          trigger_type: 'new_message_received',
          is_active: true,
          steps,
        })
      )
    );

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      error: 'Cannot activate automation with invalid configuration',
      issues,
    });
    expect(mocks.createRepository).not.toHaveBeenCalled();
  });

  it('creates the automation through PostgreSQL and returns the existing 201 shape', async () => {
    const input = {
      name: 'Synthetic automation',
      description: null,
      trigger_type: 'new_message_received',
      trigger_config: {},
      is_active: false,
      steps,
    };

    const response = await POST(postRequest(JSON.stringify(input)));

    expect(response.status).toBe(201);
    expect(await response.json()).toEqual({ automation: createdAutomation });
    expect(mocks.createRepository).toHaveBeenCalledTimes(1);
    expect(mocks.createRepository).toHaveBeenCalledWith(expect.any(Function));
    expect(mocks.createAutomation).toHaveBeenCalledWith(input);
    expect(mocks.authenticatedFrom).not.toHaveBeenCalled();
    expect(mocks.supabaseAdmin).not.toHaveBeenCalled();
    expect(mocks.insertSteps).not.toHaveBeenCalled();
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
      mocks.createAutomation.mockRejectedValueOnce(new AppError(code));

      const response = await POST(
        postRequest(
          JSON.stringify({
            name: 'Synthetic automation',
            trigger_type: 'new_message_received',
          })
        )
      );

      expect(response.status).toBe(status);
      expect(await response.json()).toEqual({ error: message });
      expect(mocks.authenticatedFrom).not.toHaveBeenCalled();
      expect(mocks.supabaseAdmin).not.toHaveBeenCalled();
    }
  );
});
