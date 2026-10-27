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
import { createPostgresTemplateLifecycleContextRepository } from './template-lifecycle-context';

const sessionA = { userId: '00000000-0000-4000-8000-000000000003' };
const accountA = '10000000-0000-4000-8000-000000000001';
const templateId = '30000000-0000-4000-8000-000000000009';
const contextRows: Record<string, unknown>[] = [
  { status: 'PAUSED', metaTemplateId: 'SYNTHETIC_META_ID', name: 'Reminder' },
];

function setupTransactions({
  rows = contextRows,
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
      throw new Error('Unexpected SQL in test: ' + sql);
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

describe('PostgreSQL template lifecycle context repository', () => {
  beforeEach(() => {
    mocks.withTransaction.mockReset();
  });

  it('requires verified account membership before lookup', async () => {
    const repository = createPostgresTemplateLifecycleContextRepository(
      async () => null
    );

    await expect(repository.getForEdit(templateId)).rejects.toEqual(
      new AppError('unauthorized')
    );
    expect(mocks.withTransaction).not.toHaveBeenCalled();
  });

  it('returns only edit context and scopes it to the verified account', async () => {
    const { queries } = setupTransactions();
    const repository = createPostgresTemplateLifecycleContextRepository(
      async () => sessionA
    );

    await expect(repository.getForEdit(templateId)).resolves.toEqual({
      status: 'PAUSED',
      metaTemplateId: 'SYNTHETIC_META_ID',
    });

    const lookup = queries.find(([sql]) =>
      sql.includes('FROM public.message_templates AS template')
    );
    expect(lookup?.[0]).toContain('template.id = $1');
    expect(lookup?.[0]).toContain('template.account_id = $2');
    expect(lookup?.[0]).toContain('template.account_id = $2');
    expect(lookup?.[0]).not.toContain('public.profiles AS creator');
    expect(lookup?.[0]).toContain('LIMIT 2');
    expect(lookup?.[1]).toEqual([templateId, accountA]);
    const projection = lookup?.[0].split(
      'FROM public.message_templates AS template'
    )[0];
    expect(projection).toContain('template.status');
    expect(projection).toContain('template.meta_template_id');
    expect(projection).not.toContain('SELECT *');
    expect(projection).not.toContain('template.name');
    expect(projection).not.toContain('submission_error');
    expect(queries).toContainEqual([
      "SELECT set_config('request.jwt.claim.sub', $1, true)",
      [sessionA.userId],
    ]);
  });

  it('returns only delete context and preserves nullable Meta ID', async () => {
    const { queries } = setupTransactions({
      rows: [{ status: 'DRAFT', metaTemplateId: null, name: 'Local draft' }],
    });
    const repository = createPostgresTemplateLifecycleContextRepository(
      async () => sessionA
    );

    await expect(repository.getForDelete(templateId)).resolves.toEqual({
      name: 'Local draft',
      metaTemplateId: null,
    });

    const lookup = queries.find(([sql]) =>
      sql.includes('FROM public.message_templates AS template')
    );
    const projection = lookup?.[0].split(
      'FROM public.message_templates AS template'
    )[0];
    expect(projection).toContain('template.name');
    expect(projection).toContain('template.meta_template_id');
    expect(projection).not.toContain('SELECT *');
    expect(projection).not.toContain('template.status');
    expect(lookup?.[1]).toEqual([templateId, accountA]);
  });

  it.each(['getForEdit', 'getForDelete'] as const)(
    'returns null when %s cannot see the row',
    async (method) => {
      setupTransactions({ rows: [] });
      const repository = createPostgresTemplateLifecycleContextRepository(
        async () => sessionA
      );

      await expect(repository[method](templateId)).resolves.toBeNull();
    }
  );

  it('rejects invalid template UUID before account lookup', async () => {
    const repository = createPostgresTemplateLifecycleContextRepository(
      async () => sessionA
    );

    await expect(repository.getForEdit('../template')).rejects.toEqual(
      new AppError('bad_request')
    );
    expect(mocks.withTransaction).not.toHaveBeenCalled();
  });

  it('fails closed for malformed lifecycle context from PostgreSQL', async () => {
    setupTransactions({
      rows: [{ status: null, metaTemplateId: 42, name: null }],
    });
    const repository = createPostgresTemplateLifecycleContextRepository(
      async () => sessionA
    );

    await expect(repository.getForEdit(templateId)).rejects.toEqual(
      new AppError('db_error')
    );
    await expect(repository.getForDelete(templateId)).rejects.toEqual(
      new AppError('db_error')
    );
  });
});
