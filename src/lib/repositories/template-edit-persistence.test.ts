import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AppError, dbFailure, dbSuccess, toAppError } from '../db/errors';

const mocks = vi.hoisted(() => ({
  withTransaction: vi.fn(),
}));

vi.mock('server-only', () => ({}));
vi.mock('../db/postgres-client', () => ({
  withTransaction: mocks.withTransaction,
}));

import type { DbTransaction } from '../db/postgres-client';
import { createPostgresTemplateEditPersistenceRepository } from './template-edit-persistence';

const ownerA = { userId: '00000000-0000-4000-8000-000000000001' };
const viewerA = { userId: '00000000-0000-4000-8000-000000000003' };
const accountA = '10000000-0000-4000-8000-000000000001';
const templateId = '30000000-0000-4000-8000-000000000021';

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
} as const;

function setupTransactions({
  rows = [
    { id: templateId, status: 'APPROVED', metaTemplateId: 'SYNTHETIC_META_ID' },
  ],
  role = 'owner',
  membershipUserId = ownerA.userId,
  returnedId = templateId,
}: {
  rows?: Record<string, unknown>[];
  role?: string;
  membershipUserId?: string;
  returnedId?: string;
} = {}) {
  const queries: Array<readonly [sql: string, values?: readonly unknown[]]> =
    [];
  const transactionQuery = vi.fn(
    async (...args: [sql: string, values?: readonly unknown[]]) => {
      const [sql] = args;
      queries.push(args);
      if (sql.includes('set_config')) return { rows: [], rowCount: 1 };
      if (sql.includes('FROM public.profiles AS p')) {
        return {
          rows: [
            {
              userId: membershipUserId,
              accountId: accountA,
              role,
              accountName: 'Synthetic Account A',
            },
          ],
          rowCount: 1,
        };
      }
      if (sql.includes('FROM public.message_templates AS template')) {
        return { rows, rowCount: rows.length };
      }
      if (sql.includes('UPDATE public.message_templates AS template')) {
        if (sql.includes('template.user_id::text AS user_id')) {
          return {
            rows: [
              {
                id: returnedId,
                user_id: ownerA.userId,
                account_id: accountA,
                name: 'stored_template_name',
                category: 'Utility',
                language: 'en_US',
                header_type: 'text',
                header_content: 'Olá {{1}}',
                body_text: 'Sua visita é às {{1}}.',
                footer_text: null,
                buttons: [{ type: 'QUICK_REPLY', text: 'Confirmar' }],
                status: 'PENDING',
                created_at: new Date('2026-10-19T12:00:00.000Z'),
                updated_at: new Date('2026-10-20T12:00:00.000Z'),
                sample_values: {
                  body: ['amanhã às 10h'],
                  header: ['cliente'],
                },
                meta_template_id: 'SYNTHETIC_META_ID',
                rejection_reason: null,
                quality_score: 'GREEN',
                header_handle: 'SYNTHETIC_HANDLE',
                header_media_url: 'https://synthetic.invalid/new.png',
                submission_error: null,
                last_submitted_at: new Date('2026-10-20T12:00:00.000Z'),
              },
            ],
            rowCount: 1,
          };
        }
        return { rows: [{ id: returnedId }], rowCount: 1 };
      }
      throw new Error(`Unexpected SQL in test: ${sql}`);
    }
  );
  const transaction = { query: transactionQuery } as unknown as DbTransaction;

  mocks.withTransaction.mockImplementation(async (operation) => {
    try {
      return dbSuccess(await operation(transaction));
    } catch (error) {
      return dbFailure(toAppError(error));
    }
  });

  return { queries, transactionQuery };
}

describe('PostgreSQL template-edit persistence repository', () => {
  beforeEach(() => {
    mocks.withTransaction.mockReset();
  });

  it('requires a verified session before opening the write transaction', async () => {
    const repository = createPostgresTemplateEditPersistenceRepository(
      async () => null
    );

    await expect(
      repository.persist({
        templateId,
        lastSubmittedAt: '2026-10-20T12:00:00Z',
        outcome: {
          kind: 'provider_failure',
          error: 'Synthetic provider failure',
        },
      })
    ).rejects.toEqual(new AppError('unauthorized'));
    expect(mocks.withTransaction).not.toHaveBeenCalled();
  });

  it('requires admin membership before writing', async () => {
    const { queries } = setupTransactions({
      role: 'viewer',
      membershipUserId: viewerA.userId,
    });
    const repository = createPostgresTemplateEditPersistenceRepository(
      async () => viewerA
    );

    await expect(
      repository.persist({
        templateId,
        lastSubmittedAt: '2026-10-20T12:00:00Z',
        outcome: {
          kind: 'provider_failure',
          error: 'Synthetic provider failure',
        },
      })
    ).rejects.toEqual(new AppError('forbidden'));
    expect(
      queries.some(([sql]) =>
        sql.includes('UPDATE public.message_templates AS template')
      )
    ).toBe(false);
  });

  it('persists the provider failure without changing template content', async () => {
    const { queries } = setupTransactions();
    const repository = createPostgresTemplateEditPersistenceRepository(
      async () => ownerA
    );

    await expect(
      repository.persist({
        templateId,
        lastSubmittedAt: '2026-10-20T12:00:00Z',
        outcome: {
          kind: 'provider_failure',
          error: 'Synthetic provider failure',
        },
      })
    ).resolves.toEqual({
      id: templateId,
      action: 'updated',
      template: null,
    });

    const update = queries.find(([sql]) =>
      sql.includes('UPDATE public.message_templates AS template')
    );
    const lookup = queries.find(([sql]) =>
      sql.includes('FROM public.message_templates AS template')
    );
    expect(lookup?.[0]).toContain('FOR UPDATE OF template');
    expect(lookup?.[0]).toContain('template.id = $1');
    expect(lookup?.[0]).toContain('template.account_id = $2');
    expect(lookup?.[0]).toContain('template.account_id = $2');
    expect(lookup?.[0]).not.toContain('public.profiles AS creator');
    expect(lookup?.[1]).toEqual([templateId, accountA]);
    expect(update?.[0]).toContain('SET submission_error = $1');
    expect(update?.[0]).toContain('last_submitted_at = $2');
    expect(update?.[0]).not.toContain('body_text =');
    expect(update?.[1]).toEqual([
      'Synthetic provider failure',
      '2026-10-20T12:00:00Z',
      templateId,
      accountA,
    ]);
  });

  it('persists a successful edit, resets status/errors, and preserves stable identity', async () => {
    const { queries } = setupTransactions();
    const repository = createPostgresTemplateEditPersistenceRepository(
      async () => ownerA
    );

    const persisted = await repository.persist({
      templateId,
      lastSubmittedAt: '2026-10-20T12:00:00Z',
      outcome: { kind: 'provider_success', payload: validPayload },
    });
    expect(persisted).toMatchObject({
      id: templateId,
      action: 'updated',
      template: {
        id: templateId,
        user_id: ownerA.userId,
        account_id: accountA,
        name: 'stored_template_name',
        language: 'en_US',
        status: 'PENDING',
        quality_score: 'GREEN',
      },
    });
    expect(persisted.template).toHaveProperty('created_at');
    expect(persisted.template).toHaveProperty('updated_at');

    const update = queries.find(([sql]) =>
      sql.includes('UPDATE public.message_templates AS template')
    );
    expect(update?.[0]).toContain("status = 'PENDING'");
    expect(update?.[0]).toContain('submission_error = NULL');
    expect(update?.[0]).toContain('rejection_reason = NULL');
    expect(update?.[0]).toContain('header_media_url');
    expect(update?.[0]).not.toContain('meta_template_id =');
    expect(update?.[0]).not.toContain('name =');
    expect(update?.[0]).not.toContain('language =');
    expect(update?.[0]).not.toContain('updated_at =');
    expect(update?.[0]).not.toContain('RETURNING *');
    expect(update?.[0]).toContain('template.name,');
    expect(update?.[0]).toContain('template.language,');
    expect(update?.[0]).toContain('template.quality_score,');
    expect(update?.[1]).toEqual([
      'Utility',
      'text',
      'Olá {{1}}',
      'https://synthetic.invalid/new.png',
      'SYNTHETIC_HANDLE',
      'Sua visita é às {{1}}.',
      null,
      JSON.stringify(validPayload.buttons),
      JSON.stringify(validPayload.sample_values),
      '2026-10-20T12:00:00Z',
      templateId,
      accountA,
    ]);
  });

  it.each([
    [
      'invalid template id',
      '../template',
      validPayload,
      '2026-10-20T12:00:00Z',
    ],
    ['invalid timestamp', templateId, validPayload, 'not-a-date'],
    [
      'invalid template name',
      templateId,
      { ...validPayload, name: 'Bad Name' },
      '2026-10-20T12:00:00Z',
    ],
    [
      'empty body',
      templateId,
      { ...validPayload, body_text: '  ' },
      '2026-10-20T12:00:00Z',
    ],
    [
      'invalid media URL',
      templateId,
      {
        ...validPayload,
        header_type: 'image',
        header_content: null,
        header_media_url: 'javascript:alert(1)',
        sample_values: { body: ['amanhã às 10h'] },
      },
      '2026-10-20T12:00:00Z',
    ],
    [
      'malformed header type',
      templateId,
      { ...validPayload, header_type: 42 },
      '2026-10-20T12:00:00Z',
    ],
    [
      'too many URL buttons',
      templateId,
      {
        ...validPayload,
        buttons: [
          { type: 'URL', text: 'Abrir 1', url: 'https://synthetic.invalid/1' },
          { type: 'URL', text: 'Abrir 2', url: 'https://synthetic.invalid/2' },
          { type: 'URL', text: 'Abrir 3', url: 'https://synthetic.invalid/3' },
        ],
      },
      '2026-10-20T12:00:00Z',
    ],
    [
      'sample count mismatch',
      templateId,
      {
        ...validPayload,
        sample_values: { body: [], header: ['cliente'] },
      },
      '2026-10-20T12:00:00Z',
    ],
    [
      'malformed button shape',
      templateId,
      { ...validPayload, buttons: [{ type: 'URL', text: 'Abrir' }] },
      '2026-10-20T12:00:00Z',
    ],
  ])(
    'rejects malformed success input: %s',
    async (_label, id, payload, timestamp) => {
      const repository = createPostgresTemplateEditPersistenceRepository(
        async () => ownerA
      );

      await expect(
        repository.persist({
          templateId: id as string,
          lastSubmittedAt: timestamp as string,
          outcome: { kind: 'provider_success', payload },
        })
      ).rejects.toEqual(new AppError('bad_request'));
      expect(mocks.withTransaction).not.toHaveBeenCalled();
    }
  );

  it.each([
    ['empty provider error', '   '],
    ['unsupported Authentication category', null],
  ])('rejects invalid lifecycle input: %s', async (_label, error) => {
    const repository = createPostgresTemplateEditPersistenceRepository(
      async () => ownerA
    );
    const input =
      error === null
        ? {
            templateId,
            lastSubmittedAt: '2026-10-20T12:00:00Z',
            outcome: {
              kind: 'provider_success' as const,
              payload: { ...validPayload, category: 'Authentication' },
            },
          }
        : {
            templateId,
            lastSubmittedAt: '2026-10-20T12:00:00Z',
            outcome: { kind: 'provider_failure' as const, error },
          };

    await expect(repository.persist(input)).rejects.toEqual(
      new AppError('bad_request')
    );
    expect(mocks.withTransaction).not.toHaveBeenCalled();
  });

  it('fails when the row is missing or outside the verified account', async () => {
    setupTransactions({ rows: [] });
    const repository = createPostgresTemplateEditPersistenceRepository(
      async () => ownerA
    );

    await expect(
      repository.persist({
        templateId,
        lastSubmittedAt: '2026-10-20T12:00:00Z',
        outcome: {
          kind: 'provider_failure',
          error: 'Synthetic provider failure',
        },
      })
    ).rejects.toEqual(new AppError('not_found'));
  });

  it('fails when the template is not an editable submitted row', async () => {
    setupTransactions({
      rows: [{ id: templateId, status: 'DRAFT', metaTemplateId: null }],
    });
    const repository = createPostgresTemplateEditPersistenceRepository(
      async () => ownerA
    );

    await expect(
      repository.persist({
        templateId,
        lastSubmittedAt: '2026-10-20T12:00:00Z',
        outcome: {
          kind: 'provider_failure',
          error: 'Synthetic provider failure',
        },
      })
    ).rejects.toEqual(new AppError('conflict'));
  });
});
