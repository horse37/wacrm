import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AppError } from '@/lib/db/errors';

vi.mock('server-only', () => ({}));

const mocks = vi.hoisted(() => ({
  createClient: vi.fn(),
  getUser: vi.fn(),
  createLifecycleContextRepository: vi.fn(),
  getForDelete: vi.fn(),
  createLifecycleConfigRepository: vi.fn(),
  getDeleteConfig: vi.fn(),
  createDeletePersistenceRepository: vi.fn(),
  deleteTemplate: vi.fn(),
  createAccountGuards: vi.fn(),
  requireRole: vi.fn(),
  deleteMessageTemplate: vi.fn(),
  decrypt: vi.fn(),
}));

vi.mock('@/lib/supabase/server', () => ({
  createClient: mocks.createClient,
}));
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
vi.mock('@/lib/repositories/template-delete-persistence', () => ({
  createPostgresTemplateDeletePersistenceRepository:
    mocks.createDeletePersistenceRepository,
}));
vi.mock('@/lib/whatsapp/meta-api', () => ({
  deleteMessageTemplate: mocks.deleteMessageTemplate,
  editMessageTemplate: vi.fn(),
}));
vi.mock('@/lib/whatsapp/encryption', () => ({
  decrypt: mocks.decrypt,
}));

import { DELETE } from './route';

const userId = '11111111-1111-4111-8111-111111111111';
const templateId = '22222222-2222-4222-8222-222222222222';
const template = {
  name: 'synthetic-template',
  metaTemplateId: null as string | null,
};
const deleteConfig = {
  encryptedAccessToken: 'synthetic-encrypted-token',
  wabaId: 'synthetic-waba-id',
};

function context(id = templateId) {
  return { params: Promise.resolve({ id }) };
}

async function deleteRequest(id = templateId) {
  return DELETE(
    new Request(`https://wacrm.example.test/api/whatsapp/templates/${id}`, {
      method: 'DELETE',
    }),
    context(id)
  );
}

describe('DELETE /api/whatsapp/templates/[id] PostgreSQL persistence', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv('WHATSAPP_TEMPLATES_DRY_RUN', 'false');
    mocks.getUser.mockResolvedValue({ data: { user: { id: userId } } });
    mocks.createClient.mockResolvedValue({
      auth: { getUser: mocks.getUser },
    });
    mocks.getForDelete.mockResolvedValue(template);
    mocks.createLifecycleContextRepository.mockReturnValue({
      getForDelete: mocks.getForDelete,
    });
    mocks.getDeleteConfig.mockResolvedValue(deleteConfig);
    mocks.createLifecycleConfigRepository.mockReturnValue({
      getForDelete: mocks.getDeleteConfig,
    });
    mocks.deleteTemplate.mockResolvedValue(undefined);
    mocks.createDeletePersistenceRepository.mockReturnValue({
      deleteTemplate: mocks.deleteTemplate,
    });
    mocks.requireRole.mockResolvedValue({ userId, role: 'admin' });
    mocks.createAccountGuards.mockReturnValue({
      requireRole: mocks.requireRole,
    });
    mocks.decrypt.mockReturnValue('synthetic-access-token');
    mocks.deleteMessageTemplate.mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('rejects an invalid UUID before authentication or data access', async () => {
    const response = await deleteRequest('not-a-uuid');

    expect(response.status).toBe(400);
    expect(mocks.createClient).not.toHaveBeenCalled();
    expect(mocks.createLifecycleContextRepository).not.toHaveBeenCalled();
  });

  it('preserves the unauthenticated response', async () => {
    mocks.getUser.mockResolvedValue({ data: { user: null } });

    const response = await deleteRequest();

    expect(response.status).toBe(401);
    expect(mocks.createLifecycleContextRepository).not.toHaveBeenCalled();
  });

  it('returns not found for a missing or cross-account template', async () => {
    mocks.getForDelete.mockResolvedValue(null);

    const response = await deleteRequest();

    expect(response.status).toBe(404);
    expect(mocks.requireRole).not.toHaveBeenCalled();
    expect(mocks.deleteMessageTemplate).not.toHaveBeenCalled();
    expect(mocks.deleteTemplate).not.toHaveBeenCalled();
  });

  it('preserves forbidden response when the verified user has no account', async () => {
    mocks.getForDelete.mockRejectedValue(new AppError('forbidden'));

    const response = await deleteRequest();

    expect(response.status).toBe(403);
    expect(mocks.deleteMessageTemplate).not.toHaveBeenCalled();
    expect(mocks.deleteTemplate).not.toHaveBeenCalled();
  });

  it('requires admin before any Meta or local deletion effect', async () => {
    mocks.requireRole.mockRejectedValue(new AppError('forbidden'));
    mocks.getForDelete.mockResolvedValue({
      ...template,
      metaTemplateId: 'synthetic-meta-template-id',
    });

    const response = await deleteRequest();

    expect(response.status).toBe(403);
    expect(mocks.deleteMessageTemplate).not.toHaveBeenCalled();
    expect(mocks.deleteTemplate).not.toHaveBeenCalled();
  });

  it('deletes a local-only template through PostgreSQL without calling Meta', async () => {
    const response = await deleteRequest();

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      success: true,
      dry_run: false,
    });
    expect(mocks.getForDelete).toHaveBeenCalledWith(templateId);
    expect(mocks.requireRole).toHaveBeenCalledWith('admin');
    expect(mocks.deleteTemplate).toHaveBeenCalledWith(templateId);
    expect(mocks.deleteMessageTemplate).not.toHaveBeenCalled();
  });

  it('deletes the Meta template before removing its local row', async () => {
    mocks.getForDelete.mockResolvedValue({
      ...template,
      metaTemplateId: 'synthetic-meta-template-id',
    });

    const response = await deleteRequest();

    expect(response.status).toBe(200);
    expect(mocks.decrypt).toHaveBeenCalledWith(
      deleteConfig.encryptedAccessToken
    );
    expect(mocks.deleteMessageTemplate).toHaveBeenCalledWith({
      wabaId: deleteConfig.wabaId,
      accessToken: 'synthetic-access-token',
      name: template.name,
      metaTemplateId: 'synthetic-meta-template-id',
    });
    expect(mocks.requireRole.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.deleteMessageTemplate.mock.invocationCallOrder[0]
    );
    expect(
      mocks.deleteMessageTemplate.mock.invocationCallOrder[0]
    ).toBeLessThan(mocks.deleteTemplate.mock.invocationCallOrder[0]);
  });

  it('does not call Meta or delete locally when configuration is unavailable', async () => {
    mocks.getForDelete.mockResolvedValue({
      ...template,
      metaTemplateId: 'synthetic-meta-template-id',
    });
    mocks.getDeleteConfig.mockResolvedValue(null);

    const response = await deleteRequest();

    expect(response.status).toBe(400);
    expect(mocks.deleteMessageTemplate).not.toHaveBeenCalled();
    expect(mocks.deleteTemplate).not.toHaveBeenCalled();
  });

  it('keeps the local row when Meta deletion fails', async () => {
    mocks.getForDelete.mockResolvedValue({
      ...template,
      metaTemplateId: 'synthetic-meta-template-id',
    });
    mocks.deleteMessageTemplate.mockRejectedValue(
      new Error('provider failure')
    );

    const response = await deleteRequest();

    expect(response.status).toBe(502);
    expect(mocks.deleteTemplate).not.toHaveBeenCalled();
  });

  it('returns a safe database error when local persistence fails', async () => {
    mocks.deleteTemplate.mockRejectedValue(new AppError('db_error'));

    const response = await deleteRequest();

    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toEqual({
      error: 'The database operation failed.',
    });
  });
});
