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
import { createPostgresApprovedAutomationTemplatesRepository } from './approved-automation-templates';

const sessionA = { userId: '00000000-0000-4000-8000-000000000003' };
const accountA = '10000000-0000-4000-8000-000000000001';
const optionRows: Record<string, unknown>[] = [
  {
    id: '20000000-0000-4000-8000-000000000001',
    name: 'Alpha',
    language: 'en_US',
  },
  {
    id: '20000000-0000-4000-8000-000000000002',
    name: 'Beta',
    language: null,
  },
];

function setupTransactions({
  rows = optionRows,
}: {
  rows?: Record<string, unknown>[];
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
              userId: sessionA.userId,
              accountId: accountA,
              role: 'viewer',
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

  return { queries, transactionQuery };
}

describe('PostgreSQL approved automation-template repository', () => {
  beforeEach(() => {
    mocks.withTransaction.mockReset();
  });

  it('requires verified account membership before listing options', async () => {
    const repository = createPostgresApprovedAutomationTemplatesRepository(
      async () => null
    );

    await expect(repository.listForCurrentAccount()).rejects.toEqual(
      new AppError('unauthorized')
    );
    expect(mocks.withTransaction).not.toHaveBeenCalled();
  });

  it('returns validated option fields with nullable language', async () => {
    setupTransactions();
    const repository = createPostgresApprovedAutomationTemplatesRepository(
      async () => sessionA
    );

    await expect(repository.listForCurrentAccount()).resolves.toEqual(
      optionRows
    );
  });

  it('preserves account-member scope, approved-only filter, stable order, creator consistency, and minimal projection', async () => {
    const { queries } = setupTransactions();
    const repository = createPostgresApprovedAutomationTemplatesRepository(
      async () => sessionA
    );

    await repository.listForCurrentAccount();

    const list = queries.find(([sql]) =>
      sql.includes('FROM public.message_templates AS template')
    );
    expect(list?.[0]).toContain('template.account_id = $1');
    expect(list?.[0]).toContain("template.status = 'APPROVED'");
    expect(list?.[0]).toContain('WHERE template.account_id = $1');
    expect(list?.[0]).not.toContain('public.profiles AS creator');
    expect(list?.[0]).toContain('ORDER BY template.name ASC, template.id ASC');
    expect(list?.[1]).toEqual([accountA]);
    const selection = list?.[0].split(
      'FROM public.message_templates AS template'
    )[0];
    expect(selection).not.toContain('SELECT *');
    expect(selection).not.toContain('body_text');
    expect(selection).not.toContain('header_handle');
    expect(selection).not.toContain('meta_template_id');
    expect(
      queries.filter(
        ([sql, values]) =>
          sql === "SELECT set_config('request.jwt.claim.sub', $1, true)" &&
          values?.[0] === sessionA.userId
      )
    ).toHaveLength(2);
  });

  it('returns an empty list when the verified account has no approved templates', async () => {
    setupTransactions({ rows: [] });
    const repository = createPostgresApprovedAutomationTemplatesRepository(
      async () => sessionA
    );

    await expect(repository.listForCurrentAccount()).resolves.toEqual([]);
  });

  it.each([
    ['invalid template UUID', { id: 'bad-id' }],
    ['missing template name', { name: null }],
    ['invalid nullable language', { language: 42 }],
  ])('fails closed for %s', async (_label, invalidFields) => {
    const rows = optionRows.map((row) => ({ ...row }));
    rows[0] = { ...rows[0], ...invalidFields };
    setupTransactions({ rows });
    const repository = createPostgresApprovedAutomationTemplatesRepository(
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
    const repository = createPostgresApprovedAutomationTemplatesRepository(
      async () => sessionA
    );

    await expect(repository.listForCurrentAccount()).rejects.toBe(
      databaseFailure
    );
  });
});
