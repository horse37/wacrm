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
import { createPostgresTemplateLifecycleConfigRepository } from './template-lifecycle-config';

const sessionA = { userId: '00000000-0000-4000-8000-000000000003' };
const accountA = '10000000-0000-4000-8000-000000000001';
const configRows: Record<string, unknown>[] = [
  {
    encryptedAccessToken: 'SYNTHETIC_CIPHERTEXT_A',
    wabaId: 'SYNTHETIC_WABA_A',
  },
];

function setupTransactions({
  rows = configRows,
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
      if (sql.includes('FROM public.whatsapp_config')) {
        return { rows, rowCount: rows.length };
      }
      throw new Error('Unexpected SQL in lifecycle config test: ' + sql);
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

describe('PostgreSQL template lifecycle config repository', () => {
  beforeEach(() => {
    mocks.withTransaction.mockReset();
  });

  it('requires verified account membership before either config read', async () => {
    const repository = createPostgresTemplateLifecycleConfigRepository(
      async () => null
    );

    await expect(repository.getForEdit()).rejects.toEqual(
      new AppError('unauthorized')
    );
    await expect(repository.getForDelete()).rejects.toEqual(
      new AppError('unauthorized')
    );
    expect(mocks.withTransaction).not.toHaveBeenCalled();
  });

  it('returns only the encrypted access token for edit', async () => {
    const { queries } = setupTransactions();
    const repository = createPostgresTemplateLifecycleConfigRepository(
      async () => sessionA
    );

    await expect(repository.getForEdit()).resolves.toEqual({
      encryptedAccessToken: 'SYNTHETIC_CIPHERTEXT_A',
    });
    const lookup = queries.find(([sql]) =>
      sql.includes('FROM public.whatsapp_config')
    );
    expect(lookup?.[0]).toContain('access_token AS "encryptedAccessToken"');
    expect(lookup?.[0]).toContain('WHERE account_id = $1');
    expect(lookup?.[0]).not.toMatch(
      /phone_number_id|waba_id|verify_token|status|SELECT \*/i
    );
    expect(lookup?.[1]).toEqual([accountA]);
    expect(queries).toContainEqual([
      "SELECT set_config('request.jwt.claim.sub', $1, true)",
      [sessionA.userId],
    ]);
  });

  it('returns the opaque token and WABA ID for delete', async () => {
    const { queries } = setupTransactions();
    const repository = createPostgresTemplateLifecycleConfigRepository(
      async () => sessionA
    );

    const context = await repository.getForDelete();
    expect(context).toEqual({
      encryptedAccessToken: 'SYNTHETIC_CIPHERTEXT_A',
      wabaId: 'SYNTHETIC_WABA_A',
    });
    expect(Object.keys(context ?? {}).sort()).toEqual([
      'encryptedAccessToken',
      'wabaId',
    ]);
    const lookup = queries.find(([sql]) =>
      sql.includes('FROM public.whatsapp_config')
    );
    expect(lookup?.[0]).toContain('access_token AS "encryptedAccessToken"');
    expect(lookup?.[0]).toContain('waba_id AS "wabaId"');
    expect(lookup?.[0]).toContain('WHERE account_id = $1');
    expect(lookup?.[0]).not.toMatch(
      /phone_number_id|verify_token|status|SELECT \*/i
    );
    expect(lookup?.[1]).toEqual([accountA]);
  });

  it('preserves null WABA ID for local or incomplete configuration', async () => {
    setupTransactions({
      rows: [{ encryptedAccessToken: 'SYNTHETIC_CIPHERTEXT_A', wabaId: null }],
    });
    const repository = createPostgresTemplateLifecycleConfigRepository(
      async () => sessionA
    );

    await expect(repository.getForDelete()).resolves.toEqual({
      encryptedAccessToken: 'SYNTHETIC_CIPHERTEXT_A',
      wabaId: null,
    });
  });

  it('returns null when the account has no configuration', async () => {
    setupTransactions({ rows: [] });
    const repository = createPostgresTemplateLifecycleConfigRepository(
      async () => sessionA
    );

    await expect(repository.getForEdit()).resolves.toBeNull();
    await expect(repository.getForDelete()).resolves.toBeNull();
  });

  it('fails closed when account configuration is duplicated', async () => {
    setupTransactions({ rows: [...configRows, ...configRows] });
    const repository = createPostgresTemplateLifecycleConfigRepository(
      async () => sessionA
    );

    await expect(repository.getForEdit()).rejects.toEqual(
      new AppError('conflict')
    );
    await expect(repository.getForDelete()).rejects.toEqual(
      new AppError('conflict')
    );
  });

  it.each([
    ['missing encrypted access token', { encryptedAccessToken: '' }],
    ['invalid encrypted access token', { encryptedAccessToken: 42 }],
    ['invalid WABA ID', { wabaId: 42 }],
  ])('rejects malformed database fields: %s', async (_label, invalid) => {
    setupTransactions({ rows: [{ ...configRows[0], ...invalid }] });
    const repository = createPostgresTemplateLifecycleConfigRepository(
      async () => sessionA
    );

    if ('wabaId' in invalid) {
      await expect(repository.getForDelete()).rejects.toEqual(
        new AppError('db_error')
      );
    } else {
      await expect(repository.getForEdit()).rejects.toEqual(
        new AppError('db_error')
      );
    }
  });
});
