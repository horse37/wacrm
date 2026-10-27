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
import { createPostgresTemplateSendDefinitionRepository } from './template-send-definition';

const sessionA = { userId: '00000000-0000-4000-8000-000000000003' };
const accountA = '10000000-0000-4000-8000-000000000001';
const definitionRows: Record<string, unknown>[] = [
  {
    id: '20000000-0000-4000-8000-000000000003',
    userId: '00000000-0000-4000-8000-000000000003',
    name: 'Appointment reminder',
    category: 'Utility',
    bodyText: 'Your visit is at {{1}}.',
    createdAt: '2026-10-20 12:00:00+00',
    headerType: 'text',
    headerContent: 'Hello {{1}}',
    headerMediaUrl: null,
    buttons: [
      { type: 'URL', text: 'Open listing', url: 'https://example.test/{{1}}' },
      { type: 'QUICK_REPLY', text: 'Confirm' },
    ],
  },
];

function setupTransactions({
  rows = definitionRows,
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

describe('PostgreSQL template-send definition repository', () => {
  beforeEach(() => {
    mocks.withTransaction.mockReset();
  });

  it('requires verified account membership before lookup', async () => {
    const repository = createPostgresTemplateSendDefinitionRepository(
      async () => null
    );

    await expect(
      repository.findForCurrentAccount({ name: 'Appointment reminder' })
    ).rejects.toEqual(new AppError('unauthorized'));
    expect(mocks.withTransaction).not.toHaveBeenCalled();
  });

  it('returns a minimal validated definition for the send builder', async () => {
    setupTransactions();
    const repository = createPostgresTemplateSendDefinitionRepository(
      async () => sessionA
    );

    await expect(
      repository.findForCurrentAccount({ name: 'Appointment reminder' })
    ).resolves.toEqual({
      id: '20000000-0000-4000-8000-000000000003',
      user_id: sessionA.userId,
      name: 'Appointment reminder',
      category: 'Utility',
      body_text: 'Your visit is at {{1}}.',
      created_at: '2026-10-20 12:00:00+00',
      header_type: 'text',
      header_content: 'Hello {{1}}',
      buttons: [
        {
          type: 'URL',
          text: 'Open listing',
          url: 'https://example.test/{{1}}',
        },
        { type: 'QUICK_REPLY', text: 'Confirm' },
      ],
    });
  });

  it.each([undefined, null, ''])(
    'defaults an omitted or empty language (%s) to en_US',
    async (language) => {
      const { queries } = setupTransactions();
      const repository = createPostgresTemplateSendDefinitionRepository(
        async () => sessionA
      );

      await repository.findForCurrentAccount({
        name: 'Appointment reminder',
        language,
      });

      const lookup = queries.find(([sql]) =>
        sql.includes('FROM public.message_templates AS template')
      );
      expect(lookup?.[1]).toEqual([accountA, 'Appointment reminder', 'en_US']);
    }
  );

  it('preserves account/name/language matching, creator consistency, minimal projection, and transaction identity', async () => {
    const { queries } = setupTransactions();
    const repository = createPostgresTemplateSendDefinitionRepository(
      async () => sessionA
    );

    await repository.findForCurrentAccount({
      name: 'Appointment reminder',
      language: 'pt_BR',
    });

    const lookup = queries.find(([sql]) =>
      sql.includes('FROM public.message_templates AS template')
    );
    expect(lookup?.[0]).toContain('template.account_id = $1');
    expect(lookup?.[0]).toContain('template.name = $2');
    expect(lookup?.[0]).toContain('template.language = $3');
    expect(lookup?.[0]).toContain('template.account_id = $1');
    expect(lookup?.[0]).not.toContain('public.profiles AS creator');
    expect(lookup?.[0]).toContain('LIMIT 2');
    expect(lookup?.[0]).not.toContain('template.status');
    expect(lookup?.[1]).toEqual([accountA, 'Appointment reminder', 'pt_BR']);
    const selection = lookup?.[0].split(
      'FROM public.message_templates AS template'
    )[0];
    expect(selection).not.toContain('SELECT *');
    expect(selection).not.toContain('header_handle');
    expect(selection).not.toContain('sample_values');
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

  it('returns null when no matching row exists', async () => {
    setupTransactions({ rows: [] });
    const repository = createPostgresTemplateSendDefinitionRepository(
      async () => sessionA
    );

    await expect(
      repository.findForCurrentAccount({ name: 'Missing template' })
    ).resolves.toBeNull();
  });

  it('fails closed when account-level name and language match multiple owners', async () => {
    setupTransactions({ rows: [...definitionRows, ...definitionRows] });
    const repository = createPostgresTemplateSendDefinitionRepository(
      async () => sessionA
    );

    await expect(
      repository.findForCurrentAccount({ name: 'Appointment reminder' })
    ).rejects.toEqual(new AppError('conflict'));
  });

  it.each([
    ['empty name', { name: '' }],
    ['blank name', { name: '  ' }],
    ['invalid language', { name: 'Template', language: 42 }],
  ])('rejects invalid lookup input: %s', async (_label, input) => {
    const repository = createPostgresTemplateSendDefinitionRepository(
      async () => sessionA
    );

    await expect(
      repository.findForCurrentAccount(input as { name: string })
    ).rejects.toEqual(new AppError('bad_request'));
    expect(mocks.withTransaction).not.toHaveBeenCalled();
  });

  it.each([
    ['invalid template UUID', { id: 'bad-id' }],
    ['invalid user UUID', { userId: 'bad-id' }],
    ['missing template name', { name: null }],
    ['invalid category', { category: 'Service' }],
    ['missing body text', { bodyText: null }],
    ['invalid creation timestamp', { createdAt: null }],
    ['invalid nullable header type', { headerType: 'audio' }],
    ['invalid nullable header content', { headerContent: 42 }],
    ['invalid nullable media URL', { headerMediaUrl: 42 }],
    ['unsupported button shape', { buttons: [{ type: 'UNKNOWN' }] }],
  ])('fails closed for malformed row: %s', async (_label, invalidFields) => {
    const rows = definitionRows.map((row) => ({ ...row }));
    rows[0] = { ...rows[0], ...invalidFields };
    setupTransactions({ rows });
    const repository = createPostgresTemplateSendDefinitionRepository(
      async () => sessionA
    );

    await expect(
      repository.findForCurrentAccount({ name: 'Appointment reminder' })
    ).rejects.toEqual(new AppError('db_error'));
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
    const repository = createPostgresTemplateSendDefinitionRepository(
      async () => sessionA
    );

    await expect(
      repository.findForCurrentAccount({ name: 'Appointment reminder' })
    ).rejects.toBe(databaseFailure);
  });
});
