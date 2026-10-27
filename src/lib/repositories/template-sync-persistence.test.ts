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
import { createPostgresTemplateSyncPersistenceRepository } from './template-sync-persistence';

const ownerA = { userId: '00000000-0000-4000-8000-000000000001' };
const viewerA = { userId: '00000000-0000-4000-8000-000000000003' };
const accountA = '10000000-0000-4000-8000-000000000001';
const templateId = '30000000-0000-4000-8000-000000000009';

const validSnapshot = {
  name: 'Appointment reminder',
  category: 'Utility',
  language: 'pt_BR',
  headerType: 'text',
  headerContent: 'Olá {{1}}',
  headerHandle: null,
  bodyText: 'Sua visita é às {{1}}.',
  footerText: null,
  buttons: [{ type: 'QUICK_REPLY', text: 'Confirmar' }],
  sampleValues: { body: ['amanhã às 10h'] },
  status: 'APPROVED',
  metaTemplateId: 'SYNTHETIC_META_TEMPLATE_ID',
  qualityScore: 'GREEN',
  updatedAt: '2026-10-20T12:00:00.000Z',
} as const;

function setupTransactions({
  snapshot = validSnapshot,
  rows = [],
  returnedId = templateId,
  role = 'admin',
  membershipUserId = ownerA.userId,
}: {
  snapshot?: typeof validSnapshot;
  rows?: Record<string, unknown>[];
  returnedId?: string;
  role?: string;
  membershipUserId?: string;
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

  return { queries, transactionQuery, snapshot };
}

describe('PostgreSQL template-sync persistence repository', () => {
  beforeEach(() => {
    mocks.withTransaction.mockReset();
  });

  it('requires a verified session before touching database data', async () => {
    const repository = createPostgresTemplateSyncPersistenceRepository(
      async () => null
    );

    await expect(repository.upsertOne(validSnapshot)).rejects.toEqual(
      new AppError('unauthorized')
    );
    expect(mocks.withTransaction).not.toHaveBeenCalled();
  });

  it('requires admin membership before opening the write transaction', async () => {
    setupTransactions({ role: 'viewer', membershipUserId: viewerA.userId });
    const repository = createPostgresTemplateSyncPersistenceRepository(
      async () => viewerA
    );

    await expect(repository.upsertOne(validSnapshot)).rejects.toEqual(
      new AppError('forbidden')
    );
    expect(mocks.withTransaction).toHaveBeenCalledTimes(1);
  });

  it('inserts a new snapshot and returns only ID plus action', async () => {
    const { queries } = setupTransactions();
    const repository = createPostgresTemplateSyncPersistenceRepository(
      async () => ownerA
    );

    await expect(repository.upsertOne(validSnapshot)).resolves.toEqual({
      id: templateId,
      action: 'inserted',
    });

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
      validSnapshot.headerHandle,
      validSnapshot.bodyText,
      validSnapshot.footerText,
      JSON.stringify(validSnapshot.buttons),
      JSON.stringify(validSnapshot.sampleValues),
      validSnapshot.status,
      validSnapshot.metaTemplateId,
      validSnapshot.qualityScore,
      validSnapshot.updatedAt,
    ]);
    expect(insert?.[0]).not.toContain('header_media_url');
  });

  it('updates a unique exact match by both ID and verified account', async () => {
    const { queries } = setupTransactions({ rows: [{ id: templateId }] });
    const repository = createPostgresTemplateSyncPersistenceRepository(
      async () => ownerA
    );

    await expect(repository.upsertOne(validSnapshot)).resolves.toEqual({
      id: templateId,
      action: 'updated',
    });

    const update = queries.find(([sql]) =>
      sql.includes('UPDATE public.message_templates AS template')
    );
    expect(update?.[0]).toContain('WHERE template.id = $17');
    expect(update?.[0]).toContain('AND template.account_id = $1');
    expect(update?.[1]).toEqual([
      accountA,
      ownerA.userId,
      validSnapshot.name,
      validSnapshot.category,
      validSnapshot.language,
      validSnapshot.headerType,
      validSnapshot.headerContent,
      validSnapshot.headerHandle,
      validSnapshot.bodyText,
      validSnapshot.footerText,
      JSON.stringify(validSnapshot.buttons),
      JSON.stringify(validSnapshot.sampleValues),
      validSnapshot.status,
      validSnapshot.metaTemplateId,
      validSnapshot.qualityScore,
      validSnapshot.updatedAt,
      templateId,
    ]);
    expect(update?.[0]).not.toContain('header_media_url');
  });

  it('takes the same transaction-scoped advisory lock before matching and writing', async () => {
    const { queries } = setupTransactions();
    const repository = createPostgresTemplateSyncPersistenceRepository(
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
      accountA,
      validSnapshot.name,
      validSnapshot.language,
    ]);
  });

  it('fails closed on duplicate account/name/language matches without writing', async () => {
    const { queries } = setupTransactions({
      rows: [
        { id: templateId },
        { id: '30000000-0000-4000-8000-000000000008' },
      ],
    });
    const repository = createPostgresTemplateSyncPersistenceRepository(
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
    ['unsupported category', { ...validSnapshot, category: 'Service' }],
    ['unsupported header type', { ...validSnapshot, headerType: 'audio' }],
    ['unsupported status', { ...validSnapshot, status: 'UNKNOWN' }],
    ['unsupported quality score', { ...validSnapshot, qualityScore: 'BLUE' }],
    ['invalid update time', { ...validSnapshot, updatedAt: 'not-a-date' }],
    ['malformed button', { ...validSnapshot, buttons: [{ type: 'UNKNOWN' }] }],
    ['malformed samples', { ...validSnapshot, sampleValues: { body: [42] } }],
  ])('rejects invalid snapshot: %s', async (_label, snapshot) => {
    const repository = createPostgresTemplateSyncPersistenceRepository(
      async () => ownerA
    );

    await expect(repository.upsertOne(snapshot as never)).rejects.toEqual(
      new AppError('bad_request')
    );
    expect(mocks.withTransaction).not.toHaveBeenCalled();
  });

  it('rejects malformed IDs returned from PostgreSQL', async () => {
    setupTransactions({ returnedId: 'bad-id' });
    const repository = createPostgresTemplateSyncPersistenceRepository(
      async () => ownerA
    );

    await expect(repository.upsertOne(validSnapshot)).rejects.toEqual(
      new AppError('db_error')
    );
  });

  it('sets identity transaction-locally for membership and the account-scoped write', async () => {
    const { queries } = setupTransactions();
    const repository = createPostgresTemplateSyncPersistenceRepository(
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
