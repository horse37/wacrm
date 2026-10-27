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
import { createPostgresTemplateEditorDetailRepository } from './template-editor-detail';

const sessionA = { userId: '00000000-0000-4000-8000-000000000003' };
const accountA = '10000000-0000-4000-8000-000000000001';
const templateId = '20000000-0000-4000-8000-000000000001';
const editorRow: Record<string, unknown> = {
  id: templateId,
  name: 'Synthetic offer',
  category: 'Marketing',
  language: 'pt_BR',
  header_type: 'text',
  header_content: 'Olá {{1}}',
  header_media_url: null,
  body_text: 'Oferta para {{1}}',
  footer_text: 'Fale conosco',
  buttons: [
    { type: 'QUICK_REPLY', text: 'Tenho interesse' },
    {
      type: 'URL',
      text: 'Ver imóvel',
      url: 'https://example.invalid/imovel',
      example: 'https://example.invalid/imovel/123',
    },
    { type: 'PHONE_NUMBER', text: 'Ligar', phone_number: '+5500000000000' },
    { type: 'COPY_CODE', text: 'Copiar', example: 'SYNTHETIC-CODE' },
  ],
  sample_values: { body: ['Ana'], header: ['Ana'] },
};

function setupTransactions({
  row = editorRow,
  membership = true,
}: {
  row?: Record<string, unknown> | null;
  membership?: boolean;
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
          rows: membership
            ? [
                {
                  userId: sessionA.userId,
                  accountId: accountA,
                  role: 'viewer',
                  accountName: 'Synthetic Account A',
                },
              ]
            : [],
          rowCount: membership ? 1 : 0,
        };
      }
      if (sql.includes('FROM public.message_templates AS template')) {
        return { rows: row ? [row] : [], rowCount: row ? 1 : 0 };
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

describe('PostgreSQL template-editor detail repository', () => {
  beforeEach(() => {
    mocks.withTransaction.mockReset();
  });

  it('rejects malformed template UUIDs as bad requests', async () => {
    const repository = createPostgresTemplateEditorDetailRepository(
      async () => sessionA
    );

    await expect(repository.getForCurrentUser('not-a-uuid')).rejects.toEqual(
      new AppError('bad_request')
    );
    expect(mocks.withTransaction).not.toHaveBeenCalled();
  });

  it('requires verified account membership before reading the editor detail', async () => {
    const repository = createPostgresTemplateEditorDetailRepository(
      async () => null
    );

    await expect(repository.getForCurrentUser(templateId)).rejects.toEqual(
      new AppError('unauthorized')
    );
    expect(mocks.withTransaction).not.toHaveBeenCalled();
  });

  it('returns validated editor fields and nullable legacy values only', async () => {
    setupTransactions();
    const repository = createPostgresTemplateEditorDetailRepository(
      async () => sessionA
    );

    await expect(repository.getForCurrentUser(templateId)).resolves.toEqual({
      id: templateId,
      name: 'Synthetic offer',
      category: 'Marketing',
      language: 'pt_BR',
      header_type: 'text',
      header_content: 'Olá {{1}}',
      header_media_url: null,
      body_text: 'Oferta para {{1}}',
      footer_text: 'Fale conosco',
      buttons: editorRow.buttons,
      sample_values: editorRow.sample_values,
    });
  });

  it('uses the verified user/account scope, creator consistency, parameterized UUID, and minimal projection', async () => {
    const { queries } = setupTransactions();
    const repository = createPostgresTemplateEditorDetailRepository(
      async () => sessionA
    );

    await repository.getForCurrentUser(templateId);

    const detail = queries.find(([sql]) =>
      sql.includes('FROM public.message_templates AS template')
    );
    expect(detail?.[0]).toContain('template.id = $1');
    expect(detail?.[0]).toContain('template.account_id = $2');
    expect(detail?.[0]).toContain('template.user_id = $3');
    expect(detail?.[0]).toContain('creator.user_id = template.user_id');
    expect(detail?.[0]).toContain('creator.account_id = template.account_id');
    expect(detail?.[1]).toEqual([templateId, accountA, sessionA.userId]);
    const selection = detail?.[0].split(
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

  it('returns safe not-found for missing or out-of-scope templates', async () => {
    setupTransactions({ row: null });
    const repository = createPostgresTemplateEditorDetailRepository(
      async () => sessionA
    );

    await expect(repository.getForCurrentUser(templateId)).rejects.toEqual(
      new AppError('not_found')
    );
  });

  it('preserves null optional fields and JSON nulls for legacy rows', async () => {
    setupTransactions({
      row: {
        ...editorRow,
        language: null,
        header_type: null,
        header_content: null,
        header_media_url: null,
        footer_text: null,
        buttons: null,
        sample_values: null,
      },
    });
    const repository = createPostgresTemplateEditorDetailRepository(
      async () => sessionA
    );

    await expect(repository.getForCurrentUser(templateId)).resolves.toEqual({
      id: templateId,
      name: 'Synthetic offer',
      category: 'Marketing',
      language: null,
      header_type: null,
      header_content: null,
      header_media_url: null,
      body_text: 'Oferta para {{1}}',
      footer_text: null,
      buttons: null,
      sample_values: null,
    });
  });

  it.each([
    ['invalid template UUID', { id: 'bad-id' }],
    ['invalid category', { category: 'Spam' }],
    ['invalid header type', { header_type: 'audio' }],
    ['missing name', { name: null }],
    ['missing body', { body_text: null }],
    ['invalid nullable language', { language: 42 }],
    [
      'button with unknown variant',
      { buttons: [{ type: 'UNKNOWN', text: 'x' }] },
    ],
    ['button missing variant field', { buttons: [{ type: 'URL', text: 'x' }] }],
    [
      'button with unexpected field',
      {
        buttons: [{ type: 'QUICK_REPLY', text: 'x', secret: 'must not leak' }],
      },
    ],
    [
      'sample values with non-string entry',
      {
        sample_values: { body: [42] },
      },
    ],
    [
      'sample values with unknown key',
      {
        sample_values: { body: ['ok'], token: 'must not leak' },
      },
    ],
  ])('fails closed for %s', async (_label, invalidFields) => {
    setupTransactions({ row: { ...editorRow, ...invalidFields } });
    const repository = createPostgresTemplateEditorDetailRepository(
      async () => sessionA
    );

    await expect(repository.getForCurrentUser(templateId)).rejects.toEqual(
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
    const repository = createPostgresTemplateEditorDetailRepository(
      async () => sessionA
    );

    await expect(repository.getForCurrentUser(templateId)).rejects.toBe(
      databaseFailure
    );
  });
});
