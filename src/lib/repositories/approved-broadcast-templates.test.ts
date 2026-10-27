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
import { createPostgresApprovedBroadcastTemplateRepository } from './approved-broadcast-templates';

const sessionA = { userId: '00000000-0000-4000-8000-000000000003' };
const accountA = '10000000-0000-4000-8000-000000000001';
const templateRows: Record<string, unknown>[] = [
  {
    id: 'b0000000-0000-4000-8000-000000000001',
    name: 'Newest template',
    category: 'Marketing',
    language: 'pt_BR',
    body_text: 'Olá {{1}}',
  },
  {
    id: 'a0000000-0000-4000-8000-000000000001',
    name: 'Older template',
    category: 'Utility',
    language: null,
    body_text: 'Confirmação',
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

describe('PostgreSQL approved broadcast-template repository', () => {
  beforeEach(() => {
    mocks.withTransaction.mockReset();
  });

  it('requires verified account membership before listing templates', async () => {
    const repository = createPostgresApprovedBroadcastTemplateRepository(
      async () => null
    );

    await expect(repository.listForCurrentAccount()).rejects.toEqual(
      new AppError('unauthorized')
    );
    expect(mocks.withTransaction).not.toHaveBeenCalled();
  });

  it('allows an account viewer to read approved template-card fields', async () => {
    setupTransactions({ role: 'viewer' });
    const repository = createPostgresApprovedBroadcastTemplateRepository(
      async () => sessionA
    );

    await expect(repository.listForCurrentAccount()).resolves.toEqual(
      templateRows
    );
  });

  it('uses verified account scope, creator consistency, approved filter, stable order, and safe projection', async () => {
    const query = setupTransactions();
    const repository = createPostgresApprovedBroadcastTemplateRepository(
      async () => sessionA
    );

    await repository.listForCurrentAccount();

    const list = query.mock.calls.find(([sql]) =>
      sql.includes('FROM public.message_templates AS template')
    );
    expect(list?.[0]).toContain('template.account_id = $1');
    expect(list?.[0]).toContain('WHERE template.account_id = $1');
    expect(list?.[0]).not.toContain('public.profiles AS creator');
    expect(list?.[0]).toContain("template.status = 'APPROVED'");
    expect(list?.[0]).toContain(
      'ORDER BY template.created_at DESC, template.id DESC'
    );
    expect(list?.[1]).toEqual([accountA]);
    const selection = list?.[0].split(
      'FROM public.message_templates AS template'
    )[0];
    expect(selection).not.toContain('SELECT *');
    expect(selection).not.toContain('meta_template_id');
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

  it('returns an empty array when no approved templates are visible', async () => {
    setupTransactions({ rows: [] });
    const repository = createPostgresApprovedBroadcastTemplateRepository(
      async () => sessionA
    );

    await expect(repository.listForCurrentAccount()).resolves.toEqual([]);
  });

  it.each([
    ['invalid ID', { id: 'bad-id' }],
    ['invalid category', { category: 'Spam' }],
    ['missing name', { name: null }],
    ['missing body', { body_text: null }],
    ['invalid language', { language: 42 }],
  ])('fails closed for %s', async (_label, invalidFields) => {
    const rows = templateRows.map((row) => ({ ...row }));
    rows[0] = { ...rows[0], ...invalidFields };
    setupTransactions({ rows });
    const repository = createPostgresApprovedBroadcastTemplateRepository(
      async () => sessionA
    );

    await expect(repository.listForCurrentAccount()).rejects.toEqual(
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
    const repository = createPostgresApprovedBroadcastTemplateRepository(
      async () => sessionA
    );

    await expect(repository.listForCurrentAccount()).rejects.toBe(
      databaseFailure
    );
  });
});
