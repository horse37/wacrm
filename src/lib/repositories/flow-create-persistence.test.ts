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
import type { FlowCreateInput } from './flow-create-persistence';
import { createPostgresFlowCreatePersistenceRepository } from './flow-create-persistence';

const sessionA = { userId: '00000000-0000-4000-8000-000000000002' };
const accountA = '10000000-0000-4000-8000-000000000001';
const flowA = '70000000-0000-4000-8000-000000000001';
const membershipA = {
  userId: sessionA.userId,
  accountId: accountA,
  role: 'agent',
  accountName: 'Synthetic Account A',
};

const validInput: FlowCreateInput = {
  name: 'Synthetic draft',
  trigger_type: 'keyword',
  trigger_config: { keywords: ['synthetic'] },
};

const templateNodes: NonNullable<FlowCreateInput['nodes']> = [
  {
    node_key: 'start',
    node_type: 'start',
    config: { next_node_key: 'end' },
  },
  { node_key: 'end', node_type: 'end', config: {} },
];

function setupTransactions({
  role = 'agent',
  flowRows = [{ id: flowA }],
  failOnNodeInsert = false,
}: {
  role?: string;
  flowRows?: Record<string, unknown>[];
  failOnNodeInsert?: boolean;
} = {}) {
  const transactionQuery = vi.fn(
    async (...args: [sql: string, values?: readonly unknown[]]) => {
      const [sql] = args;
      if (sql.includes('set_config')) return { rows: [], rowCount: 1 };
      if (sql.includes('INNER JOIN public.accounts')) {
        return { rows: [{ ...membershipA, role }], rowCount: 1 };
      }
      if (sql.includes('INSERT INTO public.flows')) {
        return { rows: flowRows, rowCount: flowRows.length };
      }
      if (sql.includes('INSERT INTO public.flow_nodes')) {
        if (failOnNodeInsert) throw new Error('synthetic constraint failure');
        return { rows: [], rowCount: 1 };
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

describe('PostgreSQL flow creation persistence repository', () => {
  beforeEach(() => {
    mocks.withTransaction.mockReset();
  });

  it('requires a verified session before opening a mutation transaction', async () => {
    const repository = createPostgresFlowCreatePersistenceRepository(
      async () => null
    );

    await expect(repository.createDraft(validInput)).rejects.toEqual(
      new AppError('unauthorized')
    );
    expect(mocks.withTransaction).not.toHaveBeenCalled();
  });

  it('denies viewers before inserting a flow', async () => {
    const query = setupTransactions({ role: 'viewer' });
    const repository = createPostgresFlowCreatePersistenceRepository(
      async () => sessionA
    );

    await expect(repository.createDraft(validInput)).rejects.toEqual(
      new AppError('forbidden')
    );
    expect(
      query.mock.calls.some(([sql]) => sql.includes('INSERT INTO public.flows'))
    ).toBe(false);
  });

  it('rejects invalid metadata and duplicate node keys before mutation', async () => {
    const query = setupTransactions();
    const repository = createPostgresFlowCreatePersistenceRepository(
      async () => sessionA
    );

    await expect(
      repository.createDraft({ ...validInput, name: '  ' })
    ).rejects.toEqual(new AppError('bad_request'));
    await expect(
      repository.createDraft({
        ...validInput,
        nodes: [templateNodes[0], templateNodes[0]],
      })
    ).rejects.toEqual(new AppError('bad_request'));
    await expect(
      repository.createDraft({
        ...validInput,
        nodes: null,
      } as unknown as FlowCreateInput)
    ).rejects.toEqual(new AppError('bad_request'));
    expect(query.mock.calls.some(([sql]) => sql.includes('INSERT INTO'))).toBe(
      false
    );
  });

  it('creates a draft flow using creator and account from verified membership', async () => {
    const query = setupTransactions();
    const repository = createPostgresFlowCreatePersistenceRepository(
      async () => sessionA
    );

    await expect(repository.createDraft(validInput)).resolves.toBe(flowA);

    const [insert, values] = query.mock.calls.find(([sql]) =>
      sql.includes('INSERT INTO public.flows')
    ) as [string, readonly unknown[]];
    expect(values[4]).toBe('draft');
    expect(insert).toContain('FROM public.profiles');
    expect(query.mock.calls[0][1]).toEqual([sessionA.userId]);
    expect(query.mock.calls.some(([sql]) => sql.includes('flow_nodes'))).toBe(
      false
    );
  });

  it('inserts template nodes in the same transaction with default positions', async () => {
    const query = setupTransactions();
    const repository = createPostgresFlowCreatePersistenceRepository(
      async () => sessionA
    );

    await repository.createDraft({
      ...validInput,
      entry_node_id: 'start',
      nodes: templateNodes,
    });

    const writes = query.mock.calls.filter(([sql]) =>
      sql.includes('INSERT INTO')
    );
    expect(
      writes.map(([sql]) => sql.match(/INSERT INTO public\.\w+/)?.[0])
    ).toEqual([
      'INSERT INTO public.flows',
      'INSERT INTO public.flow_nodes',
      'INSERT INTO public.flow_nodes',
    ]);
    expect(writes[1][1]).toEqual([
      flowA,
      'start',
      'start',
      '{"next_node_key":"end"}',
      0,
      0,
    ]);
  });

  it('rolls back flow creation if a node insert fails', async () => {
    setupTransactions({ failOnNodeInsert: true });
    const repository = createPostgresFlowCreatePersistenceRepository(
      async () => sessionA
    );

    await expect(
      repository.createDraft({ ...validInput, nodes: templateNodes })
    ).rejects.toEqual(new AppError('db_error'));
  });

  it('rejects a membership without an insertable creator profile', async () => {
    const query = setupTransactions({ flowRows: [] });
    const repository = createPostgresFlowCreatePersistenceRepository(
      async () => sessionA
    );

    await expect(repository.createDraft(validInput)).rejects.toEqual(
      new AppError('forbidden')
    );
    expect(query.mock.calls.some(([sql]) => sql.includes('flow_nodes'))).toBe(
      false
    );
  });
});
