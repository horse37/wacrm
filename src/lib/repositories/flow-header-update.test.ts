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
import { createPostgresFlowHeaderUpdateRepository } from './flow-header-update';

const sessionA = { userId: '00000000-0000-4000-8000-000000000003' };
const accountA = '10000000-0000-4000-8000-000000000001';
const flowA = '70000000-0000-4000-8000-000000000001';
const membershipA = {
  userId: sessionA.userId,
  accountId: accountA,
  role: 'agent',
  accountName: 'Synthetic Account A',
};

function setupTransactions({
  role = 'agent',
  updatedRows = [{ id: flowA }],
}: {
  role?: string;
  updatedRows?: Record<string, unknown>[];
} = {}) {
  const transactionQuery = vi.fn(
    async (...args: [sql: string, values?: readonly unknown[]]) => {
      const [sql] = args;
      if (sql.includes('set_config')) return { rows: [], rowCount: 1 };
      if (sql.includes('INNER JOIN public.accounts')) {
        return { rows: [{ ...membershipA, role }], rowCount: 1 };
      }
      if (sql.includes('UPDATE public.flows AS flow')) {
        return { rows: updatedRows, rowCount: updatedRows.length };
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

describe('PostgreSQL flow-header update repository', () => {
  beforeEach(() => {
    mocks.withTransaction.mockReset();
  });

  it('requires a verified session before opening an update transaction', async () => {
    const repository = createPostgresFlowHeaderUpdateRepository(
      async () => null
    );

    await expect(
      repository.updateForFlow(flowA, { name: 'Updated' })
    ).rejects.toEqual(new AppError('unauthorized'));
    expect(mocks.withTransaction).not.toHaveBeenCalled();
  });

  it('denies viewers before issuing the update query', async () => {
    const query = setupTransactions({ role: 'viewer' });
    const repository = createPostgresFlowHeaderUpdateRepository(
      async () => sessionA
    );

    await expect(
      repository.updateForFlow(flowA, { name: 'Updated' })
    ).rejects.toEqual(new AppError('forbidden'));
    expect(
      query.mock.calls.some(([sql]) =>
        sql.includes('UPDATE public.flows AS flow')
      )
    ).toBe(false);
  });

  it('validates the flow UUID and rejects unsupported patch keys', async () => {
    const query = setupTransactions();
    const repository = createPostgresFlowHeaderUpdateRepository(
      async () => sessionA
    );

    await expect(
      repository.updateForFlow('invalid', { name: 'Updated' })
    ).rejects.toEqual(new AppError('bad_request'));
    await expect(
      repository.updateForFlow(flowA, { status: 'active' } as never)
    ).rejects.toEqual(new AppError('bad_request'));
    expect(
      query.mock.calls.some(([sql]) =>
        sql.includes('UPDATE public.flows AS flow')
      )
    ).toBe(false);
  });

  it('binds all allowlisted header fields and keeps account/creator scope', async () => {
    const query = setupTransactions();
    const repository = createPostgresFlowHeaderUpdateRepository(
      async () => sessionA
    );
    const injectionLikeName = "Renamed'); DELETE FROM public.flows; --";

    await expect(
      repository.updateForFlow(flowA, {
        name: injectionLikeName,
        description: null,
        trigger_type: 'manual',
        trigger_config: { keywords: ['synthetic'] },
        entry_node_id: 'start',
        fallback_policy: { on_exhaust: 'handoff' },
      })
    ).resolves.toBeUndefined();

    const update = query.mock.calls.find(([sql]) =>
      sql.includes('UPDATE public.flows AS flow')
    );
    expect(update?.[0]).toContain('flow.id = $1');
    expect(update?.[0]).toContain('flow.account_id = $2');
    expect(update?.[0]).toContain('flow.account_id = $2');
    expect(update?.[0]).not.toContain('public.profiles AS creator');
    expect(update?.[0]).toContain('updated_at = NOW()');
    expect(update?.[0]).not.toContain('SELECT *');
    expect(update?.[1]).toEqual([
      flowA,
      accountA,
      injectionLikeName,
      null,
      'manual',
      JSON.stringify({ keywords: ['synthetic'] }),
      'start',
      JSON.stringify({ on_exhaust: 'handoff' }),
    ]);
    expect(
      query.mock.calls.some(
        ([sql, values]) =>
          sql === "SELECT set_config('request.jwt.claim.sub', $1, true)" &&
          values?.[0] === sessionA.userId
      )
    ).toBe(true);
  });

  it('normalizes names and rejects invalid field values before SQL', async () => {
    const query = setupTransactions();
    const repository = createPostgresFlowHeaderUpdateRepository(
      async () => sessionA
    );

    await repository.updateForFlow(flowA, { name: '  Updated flow  ' });
    const update = query.mock.calls.find(([sql]) =>
      sql.includes('UPDATE public.flows AS flow')
    );
    expect(update?.[1]).toEqual([flowA, accountA, 'Updated flow']);

    for (const patch of [
      { name: '   ' },
      { trigger_type: 'webhook' },
      { trigger_config: [] },
      { entry_node_id: 42 },
      { fallback_policy: null },
    ]) {
      await expect(
        repository.updateForFlow(flowA, patch as never)
      ).rejects.toEqual(new AppError('bad_request'));
    }
    expect(
      query.mock.calls.filter(([sql]) =>
        sql.includes('UPDATE public.flows AS flow')
      )
    ).toHaveLength(1);
  });

  it('updates updated_at for an empty header patch without widening fields', async () => {
    const query = setupTransactions();
    const repository = createPostgresFlowHeaderUpdateRepository(
      async () => sessionA
    );

    await repository.updateForFlow(flowA, {});

    const update = query.mock.calls.find(([sql]) =>
      sql.includes('UPDATE public.flows AS flow')
    );
    expect(update?.[0]).toMatch(/SET\s+updated_at = NOW\(\)/);
    expect(update?.[1]).toEqual([flowA, accountA]);
  });

  it('returns not found for inaccessible flows and fails closed on malformed results', async () => {
    setupTransactions({ updatedRows: [] });
    const missingRepository = createPostgresFlowHeaderUpdateRepository(
      async () => sessionA
    );
    await expect(
      missingRepository.updateForFlow(flowA, { name: 'Updated' })
    ).rejects.toEqual(new AppError('not_found'));

    setupTransactions({ updatedRows: [{ id: flowA }, { id: flowA }] });
    const duplicateRepository = createPostgresFlowHeaderUpdateRepository(
      async () => sessionA
    );
    await expect(
      duplicateRepository.updateForFlow(flowA, { name: 'Updated' })
    ).rejects.toEqual(new AppError('conflict'));

    setupTransactions({ updatedRows: [{ id: 'not-a-uuid' }] });
    const malformedRepository = createPostgresFlowHeaderUpdateRepository(
      async () => sessionA
    );
    await expect(
      malformedRepository.updateForFlow(flowA, { name: 'Updated' })
    ).rejects.toEqual(new AppError('db_error'));
  });

  it('propagates safe database errors without driver details', async () => {
    const databaseFailure = new AppError('db_error');
    mocks.withTransaction
      .mockResolvedValueOnce(dbSuccess(membershipA))
      .mockResolvedValueOnce(dbFailure(databaseFailure));
    const repository = createPostgresFlowHeaderUpdateRepository(
      async () => sessionA
    );

    await expect(
      repository.updateForFlow(flowA, { name: 'Updated' })
    ).rejects.toBe(databaseFailure);
  });
});
