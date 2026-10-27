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
import { createPostgresTemplateManagerCatalogRepository } from './template-manager-catalog';

const sessionA = { userId: '00000000-0000-4000-8000-000000000003' };
const accountA = '10000000-0000-4000-8000-000000000001';
const templateRows: Record<string, unknown>[] = [
  {
    id: 'b0000000-0000-4000-8000-000000000001',
    name: 'Newest template',
    category: 'Marketing',
    status: 'PENDING',
    language: 'pt_BR',
    quality_score: 'GREEN',
    body_text: 'Olá {{1}}',
    footer_text: null,
    rejection_reason: null,
    submission_error: null,
    meta_template_id: null,
  },
  {
    id: 'a0000000-0000-4000-8000-000000000001',
    name: 'Older template',
    category: 'Utility',
    status: 'APPROVED',
    language: null,
    quality_score: null,
    body_text: 'Confirmação',
    footer_text: 'Até logo',
    rejection_reason: 'Synthetic reason',
    submission_error: 'Synthetic submit error',
    meta_template_id: 'synthetic-meta-id',
  },
];

function setupTransactions({
  role = 'viewer',
  rows = templateRows,
}: {
  role?: string;
  rows?: Record<string, unknown>[];
} = {}) {
  const transactionQuery = vi.fn(
    async (...args: [sql: string, values?: readonly unknown[]]) => {
      const [sql] = args;
      if (sql.includes('set_config')) return { rows: [], rowCount: 1 };
      if (sql.includes('INNER JOIN public.accounts')) {
        return {
          rows: [
            {
              userId: sessionA.userId,
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

  return transactionQuery;
}

describe('PostgreSQL template-manager catalog repository', () => {
  beforeEach(() => {
    mocks.withTransaction.mockReset();
  });

  it('requires verified account membership before listing templates', async () => {
    const repository = createPostgresTemplateManagerCatalogRepository(
      async () => null
    );

    await expect(repository.listForCurrentUser()).rejects.toEqual(
      new AppError('unauthorized')
    );
    expect(mocks.withTransaction).not.toHaveBeenCalled();
  });

  it('lists validated card fields for the verified user', async () => {
    setupTransactions({ role: 'viewer' });
    const repository = createPostgresTemplateManagerCatalogRepository(
      async () => sessionA
    );

    await expect(repository.listForCurrentUser()).resolves.toEqual(
      templateRows
    );
  });

  it('uses verified user/account scope, creator consistency, stable order, and a minimal projection', async () => {
    const query = setupTransactions();
    const repository = createPostgresTemplateManagerCatalogRepository(
      async () => sessionA
    );

    await repository.listForCurrentUser();

    const list = query.mock.calls.find(([sql]) =>
      sql.includes('FROM public.message_templates AS template')
    );
    expect(list?.[0]).toContain('template.account_id = $1');
    expect(list?.[0]).toContain('template.user_id = $2');
    expect(list?.[0]).toContain('creator.user_id = template.user_id');
    expect(list?.[0]).toContain('creator.account_id = template.account_id');
    expect(list?.[0]).toContain(
      'ORDER BY template.created_at DESC, template.id DESC'
    );
    expect(list?.[1]).toEqual([accountA, sessionA.userId]);
    const selection = list?.[0].split(
      'FROM public.message_templates AS template'
    )[0];
    expect(selection).not.toContain('SELECT *');
    expect(selection).not.toContain('header_handle');
    expect(selection).not.toContain('sample_values');
    expect(selection).not.toContain('user_id');
    expect(
      query.mock.calls.some(
        ([sql, values]) =>
          sql === "SELECT set_config('request.jwt.claim.sub', $1, true)" &&
          values?.[0] === sessionA.userId
      )
    ).toBe(true);
  });

  it('returns an empty array when the verified user has no templates', async () => {
    setupTransactions({ rows: [] });
    const repository = createPostgresTemplateManagerCatalogRepository(
      async () => sessionA
    );

    await expect(repository.listForCurrentUser()).resolves.toEqual([]);
  });

  it.each([
    ['invalid ID', { id: 'bad-id' }],
    ['invalid category', { category: 'Spam' }],
    ['invalid status', { status: 'PENDING_REVIEW' }],
    ['invalid quality score', { quality_score: 'BLUE' }],
    ['missing name', { name: null }],
    ['missing body', { body_text: null }],
    ['invalid language', { language: 42 }],
    ['invalid nullable field', { rejection_reason: 42 }],
  ])('fails closed for %s', async (_label, invalidFields) => {
    const rows = templateRows.map((row) => ({ ...row }));
    rows[0] = { ...rows[0], ...invalidFields };
    setupTransactions({ rows });
    const repository = createPostgresTemplateManagerCatalogRepository(
      async () => sessionA
    );

    await expect(repository.listForCurrentUser()).rejects.toEqual(
      new AppError('db_error')
    );
  });

  it('propagates safe database errors without driver details', async () => {
    const databaseFailure = new AppError('db_error');
    mocks.withTransaction
      .mockResolvedValueOnce(
        dbSuccess({
          userId: sessionA.userId,
          accountId: accountA,
          role: 'viewer',
          accountName: 'Synthetic Account A',
        })
      )
      .mockResolvedValueOnce(dbFailure(databaseFailure));
    const repository = createPostgresTemplateManagerCatalogRepository(
      async () => sessionA
    );

    await expect(repository.listForCurrentUser()).rejects.toBe(databaseFailure);
  });
});
