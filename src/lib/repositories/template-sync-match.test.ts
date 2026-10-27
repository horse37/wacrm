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
import { createPostgresTemplateSyncMatchRepository } from './template-sync-match';

const sessionA = { userId: '00000000-0000-4000-8000-000000000003' };
const accountA = '10000000-0000-4000-8000-000000000001';
const matchedId = '30000000-0000-4000-8000-000000000009';

function setupTransactions({
  rows = [{ id: matchedId }],
}: { rows?: Record<string, unknown>[] } = {}) {
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

describe('PostgreSQL template-sync match repository', () => {
  beforeEach(() => {
    mocks.withTransaction.mockReset();
  });

  it('requires a verified session before reading account data', async () => {
    const repository = createPostgresTemplateSyncMatchRepository(
      async () => null
    );

    await expect(
      repository.findExistingId({
        name: 'Appointment reminder',
        language: 'en_US',
      })
    ).rejects.toEqual(new AppError('unauthorized'));
    expect(mocks.withTransaction).not.toHaveBeenCalled();
  });

  it('returns only the validated matching template UUID', async () => {
    setupTransactions();
    const repository = createPostgresTemplateSyncMatchRepository(
      async () => sessionA
    );

    const result = await repository.findExistingId({
      name: 'Appointment reminder',
      language: 'pt_BR',
    });

    expect(result).toBe(matchedId);
  });

  it('uses exact verified account, name, and language predicates with bound values', async () => {
    const { queries } = setupTransactions();
    const repository = createPostgresTemplateSyncMatchRepository(
      async () => sessionA
    );

    await repository.findExistingId({
      name: "template' OR TRUE --",
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
    expect(lookup?.[1]).toEqual([accountA, "template' OR TRUE --", 'pt_BR']);
    const selection = lookup?.[0].split(
      'FROM public.message_templates AS template'
    )[0];
    expect(selection).toContain('template.id::text AS id');
    expect(selection).not.toContain('SELECT *');
    expect(
      queries.filter(
        ([sql, values]) =>
          sql === "SELECT set_config('request.jwt.claim.sub', $1, true)" &&
          values?.[0] === sessionA.userId
      )
    ).toHaveLength(2);
  });

  it('returns null when the account has no matching template', async () => {
    setupTransactions({ rows: [] });
    const repository = createPostgresTemplateSyncMatchRepository(
      async () => sessionA
    );

    await expect(
      repository.findExistingId({ name: 'Missing template', language: 'en_US' })
    ).resolves.toBeNull();
  });

  it('fails closed when multiple creators have the same account/name/language', async () => {
    setupTransactions({ rows: [{ id: matchedId }, { id: matchedId }] });
    const repository = createPostgresTemplateSyncMatchRepository(
      async () => sessionA
    );

    await expect(
      repository.findExistingId({ name: 'Duplicate', language: 'en_US' })
    ).rejects.toEqual(new AppError('conflict'));
  });

  it('rejects malformed input before querying PostgreSQL', async () => {
    const repository = createPostgresTemplateSyncMatchRepository(
      async () => sessionA
    );

    await expect(
      repository.findExistingId({ name: '  ', language: 'en_US' })
    ).rejects.toEqual(new AppError('bad_request'));
    await expect(
      repository.findExistingId({ name: 'Template', language: '' })
    ).rejects.toEqual(new AppError('bad_request'));
    expect(mocks.withTransaction).not.toHaveBeenCalled();
  });

  it('rejects a malformed template ID returned by the database', async () => {
    setupTransactions({ rows: [{ id: 'not-a-uuid' }] });
    const repository = createPostgresTemplateSyncMatchRepository(
      async () => sessionA
    );

    await expect(
      repository.findExistingId({
        name: 'Appointment reminder',
        language: 'en_US',
      })
    ).rejects.toEqual(new AppError('db_error'));
  });

  it('does not return templates whose creator profile is outside the account', async () => {
    setupTransactions({ rows: [] });
    const repository = createPostgresTemplateSyncMatchRepository(
      async () => sessionA
    );

    await expect(
      repository.findExistingId({ name: 'Orphan template', language: 'en_US' })
    ).resolves.toBeNull();
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
    const repository = createPostgresTemplateSyncMatchRepository(
      async () => sessionA
    );

    await expect(
      repository.findExistingId({
        name: 'Appointment reminder',
        language: 'en_US',
      })
    ).rejects.toBe(databaseFailure);
  });
});
