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
import { createPostgresInboxApprovedTemplatesRepository } from './inbox-approved-templates';

const sessionA = { userId: '00000000-0000-4000-8000-000000000003' };
const accountA = '10000000-0000-4000-8000-000000000001';
const templateRows: Record<string, unknown>[] = [
  {
    id: '20000000-0000-4000-8000-000000000001',
    name: 'Appointment reminder',
    category: 'Utility',
    language: 'en_US',
    headerType: 'text',
    headerContent: 'Hello {{1}}',
    bodyText: 'Your visit is at {{1}}.',
    footerText: 'Reply if you have questions.',
    buttons: [
      { type: 'URL', text: 'Open listing', url: 'https://example.test/{{1}}' },
      { type: 'QUICK_REPLY', text: 'Confirm' },
    ],
  },
  {
    id: '20000000-0000-4000-8000-000000000002',
    name: 'Plain update',
    category: 'Marketing',
    language: null,
    headerType: null,
    headerContent: null,
    bodyText: 'A short update.',
    footerText: null,
    buttons: null,
  },
];

function setupTransactions({
  rows = templateRows,
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

  return { queries };
}

describe('PostgreSQL inbox approved-template repository', () => {
  beforeEach(() => {
    mocks.withTransaction.mockReset();
  });

  it('requires verified account membership before listing templates', async () => {
    const repository = createPostgresInboxApprovedTemplatesRepository(
      async () => null
    );

    await expect(repository.listForCurrentUser()).rejects.toEqual(
      new AppError('unauthorized')
    );
    expect(mocks.withTransaction).not.toHaveBeenCalled();
  });

  it('returns validated minimal picker fields, including URL variables', async () => {
    setupTransactions();
    const repository = createPostgresInboxApprovedTemplatesRepository(
      async () => sessionA
    );

    await expect(repository.listForCurrentUser()).resolves.toEqual([
      {
        id: '20000000-0000-4000-8000-000000000001',
        name: 'Appointment reminder',
        category: 'Utility',
        language: 'en_US',
        header_type: 'text',
        header_content: 'Hello {{1}}',
        body_text: 'Your visit is at {{1}}.',
        footer_text: 'Reply if you have questions.',
        buttons: [
          {
            type: 'URL',
            text: 'Open listing',
            url: 'https://example.test/{{1}}',
          },
          { type: 'QUICK_REPLY', text: 'Confirm' },
        ],
      },
      {
        id: '20000000-0000-4000-8000-000000000002',
        name: 'Plain update',
        category: 'Marketing',
        language: null,
        header_type: null,
        header_content: null,
        body_text: 'A short update.',
        footer_text: null,
        buttons: null,
      },
    ]);
  });

  it('preserves per-user approved scope, deterministic order, creator consistency, minimal projection, and transaction identity', async () => {
    const { queries } = setupTransactions();
    const repository = createPostgresInboxApprovedTemplatesRepository(
      async () => sessionA
    );

    await repository.listForCurrentUser();

    const list = queries.find(([sql]) =>
      sql.includes('FROM public.message_templates AS template')
    );
    expect(list?.[0]).toContain('template.account_id = $1');
    expect(list?.[0]).toContain('template.user_id = $2');
    expect(list?.[0]).toContain("template.status = 'APPROVED'");
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
    expect(selection).not.toContain('meta_template_id');
    expect(selection).not.toContain('submission_error');
    expect(
      queries.filter(
        ([sql, values]) =>
          sql === "SELECT set_config('request.jwt.claim.sub', $1, true)" &&
          values?.[0] === sessionA.userId
      )
    ).toHaveLength(2);
  });

  it('returns an empty list when there are no approved templates', async () => {
    setupTransactions({ rows: [] });
    const repository = createPostgresInboxApprovedTemplatesRepository(
      async () => sessionA
    );

    await expect(repository.listForCurrentUser()).resolves.toEqual([]);
  });

  it.each([
    ['invalid template UUID', { id: 'bad-id' }],
    ['missing template name', { name: null }],
    ['invalid category', { category: 'Service' }],
    ['invalid nullable language', { language: 42 }],
    ['invalid nullable header type', { headerType: 'audio' }],
    ['invalid nullable header content', { headerContent: 42 }],
    ['missing body text', { bodyText: null }],
    ['invalid nullable footer text', { footerText: 42 }],
    ['unsupported button shape', { buttons: [{ type: 'UNKNOWN' }] }],
  ])('fails closed for %s', async (_label, invalidFields) => {
    const rows = templateRows.map((row) => ({ ...row }));
    rows[0] = { ...rows[0], ...invalidFields };
    setupTransactions({ rows });
    const repository = createPostgresInboxApprovedTemplatesRepository(
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
    const repository = createPostgresInboxApprovedTemplatesRepository(
      async () => sessionA
    );

    await expect(repository.listForCurrentUser()).rejects.toBe(databaseFailure);
  });
});
