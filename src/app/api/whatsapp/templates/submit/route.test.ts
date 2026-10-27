import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AppError } from '@/lib/db/errors';

const mocks = vi.hoisted(() => ({
  createClient: vi.fn(),
  getUser: vi.fn(),
  createAccountGuards: vi.fn(),
  requireRole: vi.fn(),
  createLifecycleConfigRepository: vi.fn(),
  getSubmitConfig: vi.fn(),
  createSubmitPersistenceRepository: vi.fn(),
  upsertOne: vi.fn(),
  decrypt: vi.fn(),
  ensureImageHeaderHandle: vi.fn(),
  buildMetaTemplatePayload: vi.fn(),
  submitMessageTemplate: vi.fn(),
}));

vi.mock('@/lib/supabase/server', () => ({
  createClient: mocks.createClient,
}));
vi.mock('@/lib/auth/postgres-account-guard', () => ({
  createDefaultPostgresAccountGuards: mocks.createAccountGuards,
}));
vi.mock('@/lib/repositories/template-lifecycle-config', () => ({
  createPostgresTemplateLifecycleConfigRepository:
    mocks.createLifecycleConfigRepository,
}));
vi.mock('@/lib/repositories/template-submit-persistence', () => ({
  createPostgresTemplateSubmitPersistenceRepository:
    mocks.createSubmitPersistenceRepository,
}));
vi.mock('@/lib/whatsapp/encryption', () => ({ decrypt: mocks.decrypt }));
vi.mock('@/lib/whatsapp/template-header-handle', () => ({
  ensureImageHeaderHandle: mocks.ensureImageHeaderHandle,
}));
vi.mock('@/lib/whatsapp/template-components', () => ({
  buildMetaTemplatePayload: mocks.buildMetaTemplatePayload,
}));
vi.mock('@/lib/whatsapp/meta-api', () => ({
  submitMessageTemplate: mocks.submitMessageTemplate,
}));

import { POST } from './route';

const userId = '11111111-1111-4111-8111-111111111111';
const accountId = '22222222-2222-4222-8222-222222222222';
const templateId = '33333333-3333-4333-8333-333333333333';
const validPayload = {
  name: 'order_confirmation',
  category: 'Utility',
  language: 'en_US',
  body_text: 'Your order is confirmed.',
};

function request(payload: unknown = validPayload) {
  return new Request(
    'https://wacrm.example.test/api/whatsapp/templates/submit',
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    }
  );
}

describe('POST /api/whatsapp/templates/submit PostgreSQL persistence', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.stubEnv('WHATSAPP_TEMPLATES_DRY_RUN', 'false');
    mocks.getUser.mockResolvedValue({
      data: { user: { id: userId } },
      error: null,
    });
    mocks.createClient.mockResolvedValue({ auth: { getUser: mocks.getUser } });
    mocks.requireRole.mockResolvedValue({ userId, accountId, role: 'admin' });
    mocks.createAccountGuards.mockReturnValue({
      requireRole: mocks.requireRole,
    });
    mocks.getSubmitConfig.mockResolvedValue({
      encryptedAccessToken: 'synthetic-encrypted-token',
      wabaId: 'synthetic-waba-id',
    });
    mocks.createLifecycleConfigRepository.mockReturnValue({
      getForDelete: mocks.getSubmitConfig,
    });
    mocks.upsertOne.mockResolvedValue({
      id: templateId,
      action: 'inserted',
      createdAt: '2026-10-21T00:01:02.000Z',
      updatedAt: '2026-10-21T00:03:04.000Z',
      qualityScore: 'GREEN',
    });
    mocks.createSubmitPersistenceRepository.mockReturnValue({
      upsertOne: mocks.upsertOne,
    });
    mocks.decrypt.mockReturnValue('synthetic-access-token');
    mocks.ensureImageHeaderHandle.mockResolvedValue(undefined);
    mocks.buildMetaTemplatePayload.mockReturnValue({
      name: 'order_confirmation',
    });
    mocks.submitMessageTemplate.mockResolvedValue({
      id: 'synthetic-meta-id',
      status: 'PENDING',
    });
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('rejects a non-admin before reading configuration or calling Meta', async () => {
    mocks.requireRole.mockRejectedValue(new AppError('forbidden'));

    const response = await POST(request());

    expect(response.status).toBe(403);
    expect(mocks.getSubmitConfig).not.toHaveBeenCalled();
    expect(mocks.ensureImageHeaderHandle).not.toHaveBeenCalled();
    expect(mocks.submitMessageTemplate).not.toHaveBeenCalled();
    expect(mocks.upsertOne).not.toHaveBeenCalled();
  });

  it('rejects an invalid payload before opening a database guard', async () => {
    const response = await POST(request({ ...validPayload, body_text: '   ' }));

    expect(response.status).toBe(400);
    expect(mocks.createAccountGuards).not.toHaveBeenCalled();
    expect(mocks.submitMessageTemplate).not.toHaveBeenCalled();
  });

  it('preserves the not-configured response without calling Meta', async () => {
    mocks.getSubmitConfig.mockResolvedValue(null);

    const response = await POST(request());

    expect(response.status).toBe(400);
    expect(mocks.submitMessageTemplate).not.toHaveBeenCalled();
    expect(mocks.upsertOne).not.toHaveBeenCalled();
  });

  it('preserves the missing WABA response without calling Meta', async () => {
    mocks.getSubmitConfig.mockResolvedValue({
      encryptedAccessToken: 'synthetic-encrypted-token',
      wabaId: null,
    });

    const response = await POST(request());

    expect(response.status).toBe(400);
    expect(mocks.submitMessageTemplate).not.toHaveBeenCalled();
    expect(mocks.upsertOne).not.toHaveBeenCalled();
  });

  it('submits to Meta and persists the provider result through PostgreSQL', async () => {
    const response = await POST(request());
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toMatchObject({ success: true, dry_run: false });
    expect(body.template).toMatchObject({
      id: templateId,
      created_at: '2026-10-21T00:01:02.000Z',
      updated_at: '2026-10-21T00:03:04.000Z',
      quality_score: 'GREEN',
    });
    expect(mocks.requireRole.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.submitMessageTemplate.mock.invocationCallOrder[0]
    );
    expect(mocks.upsertOne).toHaveBeenCalledWith(
      expect.objectContaining({
        name: validPayload.name,
        category: validPayload.category,
        language: validPayload.language,
        bodyText: validPayload.body_text,
        status: 'PENDING',
        metaTemplateId: 'synthetic-meta-id',
        submissionError: null,
      })
    );
  });

  it('persists a DRAFT error after Meta rejection', async () => {
    mocks.submitMessageTemplate.mockRejectedValue(
      new Error('Meta API rejected template')
    );

    const response = await POST(request());
    const body = await response.json();

    expect(response.status).toBe(502);
    expect(body.error).toBe('Meta API rejected template');
    expect(mocks.upsertOne).toHaveBeenCalledWith(
      expect.objectContaining({
        status: 'DRAFT',
        metaTemplateId: null,
        submissionError: 'Meta API rejected template',
      })
    );
  });

  it('preserves the Meta rate-limit response while persisting the failure', async () => {
    mocks.submitMessageTemplate.mockRejectedValue(
      new Error('Meta API returned 429: rate limit')
    );

    const response = await POST(request());
    const body = await response.json();

    expect(response.status).toBe(429);
    expect(body.error).toContain('Meta rate limit hit');
    expect(mocks.upsertOne).toHaveBeenCalledWith(
      expect.objectContaining({
        status: 'DRAFT',
        metaTemplateId: null,
        submissionError: 'Meta API returned 429: rate limit',
      })
    );
  });

  it('returns the Meta id when local persistence fails after provider success', async () => {
    mocks.upsertOne.mockRejectedValue(new AppError('db_error'));

    const response = await POST(request());
    const body = await response.json();

    expect(response.status).toBe(500);
    expect(body.meta_template_id).toBe('synthetic-meta-id');
    expect(body.error).toContain('Run "Sync from Meta" to recover.');
  });

  it('keeps dry-run local and persists its synthetic pending result', async () => {
    vi.stubEnv('WHATSAPP_TEMPLATES_DRY_RUN', 'true');

    const response = await POST(request());
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toMatchObject({ success: true, dry_run: true });
    expect(mocks.getSubmitConfig).not.toHaveBeenCalled();
    expect(mocks.submitMessageTemplate).not.toHaveBeenCalled();
    expect(mocks.upsertOne).toHaveBeenCalledWith(
      expect.objectContaining({
        status: 'PENDING',
        metaTemplateId: expect.stringMatching(/^dry-run-/),
        submissionError: null,
      })
    );
  });
});
