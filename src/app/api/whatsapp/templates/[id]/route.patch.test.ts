import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AppError } from '@/lib/db/errors';

const mocks = vi.hoisted(() => ({
  createClient: vi.fn(),
  getUser: vi.fn(),
  from: vi.fn(),
  createAccountGuards: vi.fn(),
  requireRole: vi.fn(),
  createLifecycleContextRepository: vi.fn(),
  getForEdit: vi.fn(),
  createLifecycleConfigRepository: vi.fn(),
  getEditConfig: vi.fn(),
  createEditPersistenceRepository: vi.fn(),
  persistEdit: vi.fn(),
  editMessageTemplate: vi.fn(),
  decrypt: vi.fn(),
}));

vi.mock('server-only', () => ({}));
vi.mock('@/lib/supabase/server', () => ({ createClient: mocks.createClient }));
vi.mock('@/lib/auth/postgres-account-guard', () => ({
  createDefaultPostgresAccountGuards: mocks.createAccountGuards,
}));
vi.mock('@/lib/repositories/template-lifecycle-context', () => ({
  createPostgresTemplateLifecycleContextRepository:
    mocks.createLifecycleContextRepository,
}));
vi.mock('@/lib/repositories/template-lifecycle-config', () => ({
  createPostgresTemplateLifecycleConfigRepository:
    mocks.createLifecycleConfigRepository,
}));
vi.mock('@/lib/repositories/template-edit-persistence', () => ({
  createPostgresTemplateEditPersistenceRepository:
    mocks.createEditPersistenceRepository,
}));
vi.mock('@/lib/whatsapp/meta-api', () => ({
  deleteMessageTemplate: vi.fn(),
  editMessageTemplate: mocks.editMessageTemplate,
}));
vi.mock('@/lib/whatsapp/encryption', () => ({ decrypt: mocks.decrypt }));

import { PATCH } from './route';

const userId = '11111111-1111-4111-8111-111111111111';
const templateId = '22222222-2222-4222-8222-222222222222';
const validPayload = {
  name: 'appointment_reminder',
  category: 'Utility',
  language: 'pt_BR',
  header_type: 'text',
  header_content: 'Olá {{1}}',
  header_media_url: 'https://synthetic.invalid/new.png',
  header_handle: 'SYNTHETIC_HANDLE',
  body_text: 'Sua visita é às {{1}}.',
  footer_text: null,
  buttons: [{ type: 'QUICK_REPLY', text: 'Confirmar' }],
  sample_values: { body: ['amanhã às 10h'], header: ['cliente'] },
};

const persistedTemplate = {
  id: templateId,
  user_id: userId,
  account_id: '33333333-3333-4333-8333-333333333333',
  name: 'stored_template_name',
  category: 'Utility',
  language: 'en_US',
  header_type: 'text',
  header_content: 'Olá {{1}}',
  body_text: 'Sua visita é às {{1}}.',
  footer_text: null,
  buttons: [{ type: 'QUICK_REPLY', text: 'Confirmar' }],
  status: 'PENDING',
  created_at: '2026-10-19T12:00:00.000Z',
  updated_at: '2026-10-20T12:00:00.000Z',
  sample_values: { body: ['amanhã às 10h'], header: ['cliente'] },
  meta_template_id: 'SYNTHETIC_META_ID',
  rejection_reason: null,
  quality_score: null,
  header_handle: 'SYNTHETIC_HANDLE',
  header_media_url: 'https://synthetic.invalid/new.png',
  submission_error: null,
  last_submitted_at: '2026-10-20T12:00:00.000Z',
};

function createSupabaseQuery(table: string) {
  const query = {
    select: vi.fn(() => query),
    eq: vi.fn(() => query),
    update: vi.fn(() => query),
    maybeSingle: vi.fn(async () => ({
      data:
        table === 'profiles'
          ? { account_id: '33333333-3333-4333-8333-333333333333' }
          : {
              id: templateId,
              status: 'APPROVED',
              meta_template_id: 'SYNTHETIC_META_ID',
              language: 'pt_BR',
            },
      error: null,
    })),
    single: vi.fn(async () => ({
      data: { access_token: 'synthetic-encrypted-token' },
      error: null,
    })),
  };
  return query;
}

function patchRequest() {
  return PATCH(
    new Request(
      `https://wacrm.example.test/api/whatsapp/templates/${templateId}`,
      {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(validPayload),
      }
    ),
    { params: Promise.resolve({ id: templateId }) }
  );
}

describe('PATCH /api/whatsapp/templates/[id] PostgreSQL persistence', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.stubEnv('WHATSAPP_TEMPLATES_DRY_RUN', 'false');
    mocks.getUser.mockResolvedValue({
      data: { user: { id: userId } },
      error: null,
    });
    mocks.createClient.mockResolvedValue({
      auth: { getUser: mocks.getUser },
      from: mocks.from,
    });
    mocks.from.mockImplementation((table: string) =>
      createSupabaseQuery(table)
    );
    mocks.requireRole.mockRejectedValue(new AppError('forbidden'));
    mocks.createAccountGuards.mockReturnValue({
      requireRole: mocks.requireRole,
    });
    mocks.getForEdit.mockResolvedValue({
      status: 'APPROVED',
      metaTemplateId: 'SYNTHETIC_META_ID',
    });
    mocks.createLifecycleContextRepository.mockReturnValue({
      getForEdit: mocks.getForEdit,
    });
    mocks.getEditConfig.mockResolvedValue({
      encryptedAccessToken: 'synthetic-encrypted-token',
    });
    mocks.createLifecycleConfigRepository.mockReturnValue({
      getForEdit: mocks.getEditConfig,
    });
    mocks.persistEdit.mockResolvedValue({
      id: templateId,
      action: 'updated',
      template: persistedTemplate,
    });
    mocks.createEditPersistenceRepository.mockReturnValue({
      persist: mocks.persistEdit,
    });
    mocks.decrypt.mockReturnValue('synthetic-access-token');
    mocks.editMessageTemplate.mockResolvedValue(undefined);
  });

  afterEach(() => vi.unstubAllEnvs());

  it('rejects a non-admin before editing the template on Meta', async () => {
    const response = await patchRequest();

    expect(response.status).toBe(403);
    expect(mocks.editMessageTemplate).not.toHaveBeenCalled();
    expect(mocks.from).not.toHaveBeenCalled();
  });

  it('edits Meta, persists the success snapshot in PostgreSQL, and returns the updated template', async () => {
    mocks.requireRole.mockResolvedValue({});

    const response = await patchRequest();
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.template).toEqual(persistedTemplate);
    expect(body).toMatchObject({
      success: true,
      dry_run: false,
      template: {
        id: templateId,
        name: 'stored_template_name',
        language: 'en_US',
        status: 'PENDING',
        submission_error: null,
        rejection_reason: null,
        meta_template_id: 'SYNTHETIC_META_ID',
      },
    });
    expect(mocks.requireRole.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.editMessageTemplate.mock.invocationCallOrder[0]
    );
    expect(mocks.editMessageTemplate).toHaveBeenCalledWith(
      expect.objectContaining({
        metaTemplateId: 'SYNTHETIC_META_ID',
        accessToken: 'synthetic-access-token',
      })
    );
    expect(mocks.persistEdit).toHaveBeenCalledWith(
      expect.objectContaining({
        templateId,
        outcome: { kind: 'provider_success', payload: validPayload },
      })
    );
    expect(mocks.from).not.toHaveBeenCalled();
  });

  it('persists Meta failures without changing local template content', async () => {
    mocks.requireRole.mockResolvedValue({});
    mocks.editMessageTemplate.mockRejectedValue(
      new Error('Synthetic Meta rejection')
    );

    const response = await patchRequest();
    const body = await response.json();

    expect(response.status).toBe(502);
    expect(body).toEqual({ error: 'Synthetic Meta rejection' });
    expect(mocks.persistEdit).toHaveBeenCalledWith(
      expect.objectContaining({
        templateId,
        outcome: {
          kind: 'provider_failure',
          error: 'Synthetic Meta rejection',
        },
      })
    );
    expect(mocks.from).not.toHaveBeenCalled();
  });

  it('persists local changes without Meta calls in dry-run mode', async () => {
    vi.stubEnv('WHATSAPP_TEMPLATES_DRY_RUN', 'true');
    mocks.requireRole.mockResolvedValue({});

    const response = await patchRequest();
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.dry_run).toBe(true);
    expect(mocks.getEditConfig).not.toHaveBeenCalled();
    expect(mocks.editMessageTemplate).not.toHaveBeenCalled();
    expect(mocks.persistEdit).toHaveBeenCalledWith(
      expect.objectContaining({
        outcome: { kind: 'provider_success', payload: validPayload },
      })
    );
    expect(mocks.from).not.toHaveBeenCalled();
  });

  it('does not expose database errors after Meta accepted the edit', async () => {
    mocks.requireRole.mockResolvedValue({});
    mocks.persistEdit.mockRejectedValue(new Error('Synthetic database secret'));

    const response = await patchRequest();
    const body = await response.json();

    expect(response.status).toBe(500);
    expect(body.error).toBe(
      'Edited on Meta but failed to save locally. Run "Sync from Meta" to recover.'
    );
    expect(JSON.stringify(body)).not.toContain('Synthetic database secret');
  });

  it('returns not found without calling Meta for a missing template', async () => {
    mocks.requireRole.mockResolvedValue({});
    mocks.getForEdit.mockResolvedValue(null);

    const response = await patchRequest();

    expect(response.status).toBe(404);
    expect(mocks.getEditConfig).not.toHaveBeenCalled();
    expect(mocks.editMessageTemplate).not.toHaveBeenCalled();
    expect(mocks.from).not.toHaveBeenCalled();
  });
});
