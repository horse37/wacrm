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
import { createPostgresTemplateSubmitPersistenceRepository } from './template-submit-persistence';

const ownerA = { userId: '00000000-0000-4000-8000-000000000001' };
const viewerA = { userId: '00000000-0000-4000-8000-000000000003' };
const accountA = '10000000-0000-4000-8000-000000000001';
const templateId = '30000000-0000-4000-8000-000000000019';

const validSnapshot = {
  name: 'appointment_reminder',
  category: 'Utility',
  language: 'pt_BR',
  headerType: 'text',
  headerContent: 'Olá {{1}}',
  headerMediaUrl: 'https://synthetic.invalid/new.png',
  headerHandle: 'SYNTHETIC_HANDLE',
  bodyText: 'Sua visita é às {{1}}.',
  footerText: null,
  buttons: [{ type: 'QUICK_REPLY', text: 'Confirmar' }],
  sampleValues: { body: ['amanhã às 10h'], header: ['cliente'] },
  status: 'PENDING',
  metaTemplateId: 'SYNTHETIC_META_TEMPLATE_ID',
  submissionError: null,
  lastSubmittedAt: '2026-10-20T12:00:00.000Z',
} as const;

function setupTransactions({
  rows = [],
  returnedId = templateId,
  role = 'owner',
  membershipUserId = ownerA.userId,
  membershipAccountId = accountA,
}: {
  rows?: Record<string, unknown>[];
  returnedId?: string;
  role?: string;
  membershipUserId?: string;
  membershipAccountId?: string;
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
              accountId: membershipAccountId,
              role,
              accountName: 'Synthetic Account A',
            },
          ],
          rowCount: 1,
        };
      }
      if (sql.includes('pg_advisory_xact_lock')) {
        return { rows: [], rowCount: 1 };
      }
      if (sql.includes('FROM public.message_templates AS template')) {
        return { rows, rowCount: rows.length };
      }
      if (
        sql.includes('UPDATE public.message_templates AS template') ||
        sql.includes('INSERT INTO public.message_templates')
      ) {
        return {
          rows: [
            {
              id: returnedId,
              created_at: new Date('2026-10-21T00:01:02.000Z'),
              updated_at: new Date('2026-10-21T00:03:04.000Z'),
              quality_score: 'GREEN',
            },
          ],
          rowCount: 1,
        };
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

describe('PostgreSQL template-submit persistence repository', () => {
  beforeEach(() => {
    mocks.withTransaction.mockReset();
  });

  it('requires a verified session before touching database data', async () => {
    const repository = createPostgresTemplateSubmitPersistenceRepository(
      async () => null
    );

    await expect(repository.upsertOne(validSnapshot)).rejects.toEqual(
      new AppError('unauthorized')
    );
    expect(mocks.withTransaction).not.toHaveBeenCalled();
  });

  it('requires admin membership before opening the write transaction', async () => {
    setupTransactions({ role: 'viewer', membershipUserId: viewerA.userId });
    const repository = createPostgresTemplateSubmitPersistenceRepository(
      async () => viewerA
    );

    await expect(repository.upsertOne(validSnapshot)).rejects.toEqual(
      new AppError('forbidden')
    );
    expect(mocks.withTransaction).toHaveBeenCalledTimes(1);
  });

  it('inserts a success result by the verified user/name/language key', async () => {
    const { queries } = setupTransactions();
    const repository = createPostgresTemplateSubmitPersistenceRepository(
      async () => ownerA
    );

    await expect(repository.upsertOne(validSnapshot)).resolves.toEqual({
      id: templateId,
      action: 'inserted',
      createdAt: '2026-10-21T00:01:02.000Z',
      updatedAt: '2026-10-21T00:03:04.000Z',
      qualityScore: 'GREEN',
    });

    const match = queries.find(([sql]) =>
      sql.includes('FROM public.message_templates AS template')
    );
    expect(match?.[0]).toContain('template.account_id = $1');
    expect(match?.[0]).toContain('template.user_id = $2');
    expect(match?.[0]).toContain('template.name = $3');
    expect(match?.[0]).toContain('template.language = $4');
    expect(match?.[0]).not.toContain(
      'template.account_id = $1 AND template.name'
    );

    const insert = queries.find(([sql]) =>
      sql.includes('INSERT INTO public.message_templates')
    );
    expect(insert?.[1]).toEqual([
      accountA,
      ownerA.userId,
      validSnapshot.name,
      validSnapshot.category,
      validSnapshot.language,
      validSnapshot.headerType,
      validSnapshot.headerContent,
      validSnapshot.headerMediaUrl,
      validSnapshot.headerHandle,
      validSnapshot.bodyText,
      validSnapshot.footerText,
      JSON.stringify(validSnapshot.buttons),
      JSON.stringify(validSnapshot.sampleValues),
      validSnapshot.status,
      validSnapshot.metaTemplateId,
      validSnapshot.submissionError,
      null,
      validSnapshot.lastSubmittedAt,
    ]);
    expect(insert?.[0]).toContain('rejection_reason');
    expect(insert?.[0]).toContain('created_at');
    expect(insert?.[0]).toContain('updated_at');
    expect(insert?.[0]).toContain('quality_score');
    expect(insert?.[0]).not.toContain('RETURNING *');
  });

  it('updates the matched row and replaces submitted media URL', async () => {
    const { queries } = setupTransactions({ rows: [{ id: templateId }] });
    const repository = createPostgresTemplateSubmitPersistenceRepository(
      async () => ownerA
    );

    await expect(repository.upsertOne(validSnapshot)).resolves.toEqual({
      id: templateId,
      action: 'updated',
      createdAt: '2026-10-21T00:01:02.000Z',
      updatedAt: '2026-10-21T00:03:04.000Z',
      qualityScore: 'GREEN',
    });

    const update = queries.find(([sql]) =>
      sql.includes('UPDATE public.message_templates AS template')
    );
    expect(update?.[0]).toContain('WHERE template.id = $19');
    expect(update?.[0]).toContain('AND template.account_id = $1');
    expect(update?.[0]).toContain('AND template.user_id = $2');
    expect(update?.[0]).toContain('header_media_url');
    expect(update?.[0]).toContain('template.created_at');
    expect(update?.[0]).toContain('template.updated_at');
    expect(update?.[0]).toContain('template.quality_score');
    expect(update?.[1]).toEqual([
      accountA,
      ownerA.userId,
      validSnapshot.name,
      validSnapshot.category,
      validSnapshot.language,
      validSnapshot.headerType,
      validSnapshot.headerContent,
      validSnapshot.headerMediaUrl,
      validSnapshot.headerHandle,
      validSnapshot.bodyText,
      validSnapshot.footerText,
      JSON.stringify(validSnapshot.buttons),
      JSON.stringify(validSnapshot.sampleValues),
      validSnapshot.status,
      validSnapshot.metaTemplateId,
      validSnapshot.submissionError,
      null,
      validSnapshot.lastSubmittedAt,
      templateId,
    ]);
  });

  it('persists the DRAFT failure outcome and keeps provider error bound', async () => {
    const { queries } = setupTransactions();
    const repository = createPostgresTemplateSubmitPersistenceRepository(
      async () => ownerA
    );
    const failedSubmission = {
      ...validSnapshot,
      status: 'DRAFT',
      metaTemplateId: null,
      submissionError: 'Synthetic provider rejection',
    } as const;

    await repository.upsertOne(failedSubmission);

    const insert = queries.find(([sql]) =>
      sql.includes('INSERT INTO public.message_templates')
    );
    expect(insert?.[1]?.[13]).toBe('DRAFT');
    expect(insert?.[1]?.[14]).toBeNull();
    expect(insert?.[1]?.[15]).toBe('Synthetic provider rejection');
    expect(insert?.[0]).not.toContain('Synthetic provider rejection');
  });

  it('accepts DRAFT when a successful provider result includes its Meta ID', async () => {
    setupTransactions();
    const repository = createPostgresTemplateSubmitPersistenceRepository(
      async () => ownerA
    );

    await expect(
      repository.upsertOne({
        ...validSnapshot,
        status: 'DRAFT',
        metaTemplateId: 'SYNTHETIC_META_TEMPLATE_ID',
      })
    ).resolves.toEqual({
      id: templateId,
      action: 'inserted',
      createdAt: '2026-10-21T00:01:02.000Z',
      updatedAt: '2026-10-21T00:03:04.000Z',
      qualityScore: 'GREEN',
    });
  });

  it('serializes the same account/user/name/language key before match/write', async () => {
    const { queries } = setupTransactions();
    const repository = createPostgresTemplateSubmitPersistenceRepository(
      async () => ownerA
    );

    await repository.upsertOne(validSnapshot);

    const lockIndex = queries.findIndex(([sql]) =>
      sql.includes('pg_advisory_xact_lock')
    );
    const matchIndex = queries.findIndex(([sql]) =>
      sql.includes('FROM public.message_templates AS template')
    );
    const insertIndex = queries.findIndex(([sql]) =>
      sql.includes('INSERT INTO public.message_templates')
    );
    expect(lockIndex).toBeGreaterThan(-1);
    expect(matchIndex).toBeGreaterThan(lockIndex);
    expect(insertIndex).toBeGreaterThan(matchIndex);
    expect(queries[lockIndex][1]).toEqual([
      ownerA.userId,
      validSnapshot.name,
      validSnapshot.language,
    ]);
  });

  it('uses the same advisory key for the legacy unique key across accounts', async () => {
    const lockValuesForAccount = async (membershipAccountId: string) => {
      const { queries } = setupTransactions({ membershipAccountId });
      const repository = createPostgresTemplateSubmitPersistenceRepository(
        async () => ownerA
      );

      await repository.upsertOne(validSnapshot);
      const lock = queries.find(([sql]) =>
        sql.includes('pg_advisory_xact_lock')
      );
      return lock?.[1];
    };

    const accountALock = await lockValuesForAccount(accountA);
    const accountBLock = await lockValuesForAccount(
      '10000000-0000-4000-8000-000000000002'
    );

    expect(accountALock).toEqual([
      ownerA.userId,
      validSnapshot.name,
      validSnapshot.language,
    ]);
    expect(accountBLock).toEqual(accountALock);
  });

  it('fails closed on duplicate matching rows without writing', async () => {
    const { queries } = setupTransactions({
      rows: [
        { id: templateId },
        { id: '30000000-0000-4000-8000-000000000018' },
      ],
    });
    const repository = createPostgresTemplateSubmitPersistenceRepository(
      async () => ownerA
    );

    await expect(repository.upsertOne(validSnapshot)).rejects.toEqual(
      new AppError('conflict')
    );
    expect(
      queries.some(
        ([sql]) =>
          sql.includes('UPDATE public.message_templates AS template') ||
          sql.includes('INSERT INTO public.message_templates')
      )
    ).toBe(false);
  });

  it.each([
    ['empty name', { ...validSnapshot, name: '' }],
    ['empty language', { ...validSnapshot, language: '' }],
    ['invalid template name', { ...validSnapshot, name: 'Upper Case' }],
    ['unsupported category', { ...validSnapshot, category: 'Service' }],
    [
      'unsupported Authentication submission',
      { ...validSnapshot, category: 'Authentication' },
    ],
    ['unsupported header type', { ...validSnapshot, headerType: 'audio' }],
    ['unsupported status', { ...validSnapshot, status: 'UNKNOWN' }],
    ['empty Meta ID', { ...validSnapshot, metaTemplateId: '' }],
    [
      'provider failure without DRAFT status',
      {
        ...validSnapshot,
        status: 'APPROVED',
        metaTemplateId: null,
        submissionError: 'Synthetic provider rejection',
      },
    ],
    [
      'provider failure with Meta ID',
      {
        ...validSnapshot,
        status: 'DRAFT',
        submissionError: 'Synthetic provider rejection',
      },
    ],
    [
      'provider success without Meta ID',
      { ...validSnapshot, metaTemplateId: null },
    ],
    [
      'provider success with stale error',
      { ...validSnapshot, submissionError: 'Synthetic stale error' },
    ],
    [
      'empty provider error',
      {
        ...validSnapshot,
        status: 'DRAFT',
        metaTemplateId: null,
        submissionError: '   ',
      },
    ],
    ['invalid timestamp', { ...validSnapshot, lastSubmittedAt: 'not-a-date' }],
    ['empty body', { ...validSnapshot, bodyText: '  ' }],
    ['overlong body', { ...validSnapshot, bodyText: 'x'.repeat(1025) }],
    [
      'invalid header media URL',
      {
        ...validSnapshot,
        headerType: 'image',
        headerContent: null,
        headerMediaUrl: 'javascript:alert(1)',
      },
    ],
    [
      'too many URL buttons',
      {
        ...validSnapshot,
        buttons: [
          { type: 'URL', text: 'Abrir 1', url: 'https://synthetic.invalid/1' },
          { type: 'URL', text: 'Abrir 2', url: 'https://synthetic.invalid/2' },
          { type: 'URL', text: 'Abrir 3', url: 'https://synthetic.invalid/3' },
        ],
      },
    ],
    ['malformed button', { ...validSnapshot, buttons: [{ type: 'UNKNOWN' }] }],
    ['malformed samples', { ...validSnapshot, sampleValues: { body: [42] } }],
  ])('rejects invalid snapshot: %s', async (_label, snapshot) => {
    const repository = createPostgresTemplateSubmitPersistenceRepository(
      async () => ownerA
    );

    await expect(repository.upsertOne(snapshot as never)).rejects.toEqual(
      new AppError('bad_request')
    );
    expect(mocks.withTransaction).not.toHaveBeenCalled();
  });

  it('rejects malformed IDs returned from PostgreSQL', async () => {
    setupTransactions({ returnedId: 'bad-id' });
    const repository = createPostgresTemplateSubmitPersistenceRepository(
      async () => ownerA
    );

    await expect(repository.upsertOne(validSnapshot)).rejects.toEqual(
      new AppError('db_error')
    );
  });

  it('sets verified identity transaction-locally for lookup and write', async () => {
    const { queries } = setupTransactions();
    const repository = createPostgresTemplateSubmitPersistenceRepository(
      async () => ownerA
    );

    await repository.upsertOne(validSnapshot);

    expect(
      queries.filter(
        ([sql, values]) =>
          sql === "SELECT set_config('request.jwt.claim.sub', $1, true)" &&
          values?.[0] === ownerA.userId
      )
    ).toHaveLength(2);
  });
});
