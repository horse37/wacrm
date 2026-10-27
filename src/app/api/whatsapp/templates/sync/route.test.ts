import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AppError } from '@/lib/db/errors';

const mocks = vi.hoisted(() => ({
  createClient: vi.fn(),
  createDefaultPostgresAccountGuards: vi.fn(),
  createPostgresTemplateLifecycleConfigRepository: vi.fn(),
  createPostgresTemplateSyncPersistenceRepository: vi.fn(),
  decrypt: vi.fn(),
}));

vi.mock('@/lib/supabase/server', () => ({
  createClient: mocks.createClient,
}));
vi.mock('@/lib/auth/postgres-account-guard', () => ({
  createDefaultPostgresAccountGuards: mocks.createDefaultPostgresAccountGuards,
}));
vi.mock('@/lib/repositories/template-lifecycle-config', () => ({
  createPostgresTemplateLifecycleConfigRepository:
    mocks.createPostgresTemplateLifecycleConfigRepository,
}));
vi.mock('@/lib/repositories/template-sync-persistence', () => ({
  createPostgresTemplateSyncPersistenceRepository:
    mocks.createPostgresTemplateSyncPersistenceRepository,
}));
vi.mock('@/lib/whatsapp/encryption', () => ({ decrypt: mocks.decrypt }));

import { POST } from './route';

const userId = '00000000-0000-4000-8000-000000000001';
const accountId = '10000000-0000-4000-8000-000000000001';
const template = {
  id: 'SYNTHETIC_META_TEMPLATE_ID',
  name: 'synthetic_reminder',
  language: 'pt_BR',
  status: 'APPROVED',
  category: 'UTILITY',
  quality_score: { score: 'GREEN' },
  components: [
    {
      type: 'HEADER',
      format: 'TEXT',
      text: 'Olá {{1}}',
      example: { header_text: ['Pessoa'] },
    },
    {
      type: 'BODY',
      text: 'Sua visita está marcada.',
      example: { body_text: [['amanhã']] },
    },
    { type: 'BUTTONS', buttons: [{ type: 'QUICK_REPLY', text: 'Confirmar' }] },
  ],
};

function metaResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function setup({
  user = { id: userId },
  authError = null,
  requireRoleError,
  config = {
    encryptedAccessToken: 'SYNTHETIC_CIPHERTEXT',
    wabaId: 'SYNTHETIC_WABA_ID',
  },
  upsertResults = [
    { id: '20000000-0000-4000-8000-000000000001', action: 'inserted' },
  ],
  upsertError,
}: {
  user?: { id: string } | null;
  authError?: Error | null;
  requireRoleError?: Error;
  config?: { encryptedAccessToken: string; wabaId: string | null } | null;
  upsertResults?: Array<{ id: string; action: 'inserted' | 'updated' }>;
  upsertError?: Error;
} = {}) {
  const requireRole = vi.fn(async () => {
    if (requireRoleError) throw requireRoleError;
    return { userId, accountId, role: 'admin' };
  });
  const getForDelete = vi.fn().mockResolvedValue(config);
  const upsertOne = vi.fn();

  mocks.createClient.mockResolvedValue({
    auth: {
      getUser: vi.fn().mockResolvedValue({
        data: { user },
        error: authError,
      }),
    },
  });
  mocks.createDefaultPostgresAccountGuards.mockReturnValue({ requireRole });
  mocks.createPostgresTemplateLifecycleConfigRepository.mockReturnValue({
    getForDelete,
  });
  mocks.createPostgresTemplateSyncPersistenceRepository.mockReturnValue({
    upsertOne,
  });
  mocks.decrypt.mockReturnValue('SYNTHETIC_ACCESS_TOKEN');

  if (upsertError) {
    upsertOne.mockRejectedValue(upsertError);
  } else {
    for (const result of upsertResults) {
      upsertOne.mockResolvedValueOnce(result);
    }
  }

  return { getForDelete, requireRole, upsertOne };
}

describe('POST /api/whatsapp/templates/sync PostgreSQL persistence', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal('fetch', vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('rejects a missing or invalid server session before database or Meta access', async () => {
    setup({ user: null });

    const response = await POST();

    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: 'Unauthorized' });
    expect(mocks.createDefaultPostgresAccountGuards).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
  });

  it('requires admin access before reading configuration or calling Meta', async () => {
    const { getForDelete } = setup({
      requireRoleError: new AppError(
        'forbidden',
        undefined,
        'insufficient_role'
      ),
    });

    const response = await POST();

    expect(response.status).toBe(403);
    expect(getForDelete).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
  });

  it('returns a configuration error when account has no WhatsApp config', async () => {
    setup({ config: null });

    const response = await POST();

    expect(response.status).toBe(400);
    expect(fetch).not.toHaveBeenCalled();
  });

  it('returns a configuration error when WABA ID is absent', async () => {
    setup({
      config: {
        encryptedAccessToken: 'SYNTHETIC_CIPHERTEXT',
        wabaId: null,
      },
    });

    const response = await POST();

    expect(response.status).toBe(400);
    expect(fetch).not.toHaveBeenCalled();
  });

  it('preserves Meta errors as a 502 without attempting local persistence', async () => {
    const { upsertOne } = setup();
    vi.mocked(fetch).mockResolvedValue(
      metaResponse({ error: { message: 'Synthetic Meta failure' } }, 503)
    );

    const response = await POST();

    expect(response.status).toBe(502);
    expect(await response.json()).toEqual({ error: 'Synthetic Meta failure' });
    expect(upsertOne).not.toHaveBeenCalled();
  });

  it.each([
    'https://attacker.example/steal-token',
    'http://graph.facebook.com/v21.0/next-page',
    'https://user@graph.facebook.com/v21.0/next-page',
    'https://graph.facebook.com/v20.0/next-page',
  ])(
    'rejects unsafe Meta pagination URL %s before forwarding the token',
    async (nextUrl) => {
      const { upsertOne } = setup();
      vi.mocked(fetch).mockResolvedValueOnce(
        metaResponse({ data: [template], paging: { next: nextUrl } })
      );

      const response = await POST();

      expect(response.status).toBe(502);
      expect(await response.json()).toEqual({
        error: 'Meta returned an invalid pagination URL.',
      });
      expect(fetch).toHaveBeenCalledTimes(1);
      expect(upsertOne).not.toHaveBeenCalled();
    }
  );

  it('maps paginated Meta templates and reports insert/update counts', async () => {
    const { upsertOne, requireRole, getForDelete } = setup({
      upsertResults: [
        { id: '20000000-0000-4000-8000-000000000001', action: 'inserted' },
        { id: '20000000-0000-4000-8000-000000000002', action: 'updated' },
      ],
    });
    vi.mocked(fetch)
      .mockResolvedValueOnce(
        metaResponse({
          data: [template],
          paging: { next: 'https://graph.facebook.com/v21.0/next-page' },
        })
      )
      .mockResolvedValueOnce(
        metaResponse({ data: [{ ...template, id: 'META_TEMPLATE_2' }] })
      );

    const response = await POST();
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toMatchObject({
      success: true,
      total: 2,
      inserted: 1,
      updated: 1,
      errors: [],
      truncated: false,
    });
    expect(requireRole).toHaveBeenCalledWith('admin');
    expect(getForDelete).toHaveBeenCalledOnce();
    expect(mocks.decrypt).toHaveBeenCalledWith('SYNTHETIC_CIPHERTEXT');
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(vi.mocked(fetch).mock.calls[0]?.[1]).toMatchObject({
      headers: { Authorization: 'Bearer SYNTHETIC_ACCESS_TOKEN' },
    });
    expect(upsertOne).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        name: template.name,
        category: 'Utility',
        language: 'pt_BR',
        headerType: 'text',
        headerContent: 'Olá {{1}}',
        bodyText: 'Sua visita está marcada.',
        buttons: [{ type: 'QUICK_REPLY', text: 'Confirmar' }],
        sampleValues: { body: ['amanhã'], header: ['Pessoa'] },
        status: 'APPROVED',
        metaTemplateId: template.id,
        qualityScore: 'GREEN',
      })
    );
  });

  it('continues after an individual persistence failure and reports the item error', async () => {
    const { upsertOne } = setup();
    upsertOne
      .mockRejectedValueOnce(new Error('Synthetic persistence failure'))
      .mockResolvedValueOnce({
        id: '20000000-0000-4000-8000-000000000002',
        action: 'inserted',
      });
    vi.mocked(fetch).mockResolvedValue(
      metaResponse({ data: [template, { ...template, id: 'META_TEMPLATE_2' }] })
    );

    const response = await POST();
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.success).toBe(false);
    expect(body.total).toBe(2);
    expect(body.inserted).toBe(1);
    expect(body.errors).toHaveLength(1);
    expect(body.errors[0]).toMatchObject({
      name: template.name,
      language: template.language,
    });
    expect(body.errors[0].message).toBeTruthy();
    expect(upsertOne).toHaveBeenCalledTimes(2);
  });

  it('stops after the page cap and reports that remaining pages were truncated', async () => {
    setup();
    vi.mocked(fetch).mockImplementation(async () =>
      metaResponse({
        data: [],
        paging: { next: 'https://graph.facebook.com/v21.0/next-page' },
      })
    );

    const response = await POST();
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toMatchObject({
      success: true,
      total: 0,
      inserted: 0,
      updated: 0,
      errors: [],
      truncated: true,
    });
    expect(fetch).toHaveBeenCalledTimes(20);
  });
});
