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
import { createPostgresPipelineDealCreateRepository } from './pipeline-deal-create';

const sessionA = { userId: '00000000-0000-4000-8000-000000000001' };
const accountA = '10000000-0000-4000-8000-000000000001';
const pipelineA = '50000000-0000-4000-8000-000000000001';
const stageA = '60000000-0000-4000-8000-000000000001';
const contactA = '40000000-0000-4000-8000-000000000001';
const profileA = '90000000-0000-4000-8000-000000000001';
const createdDeal = '70000000-0000-4000-8000-000000000099';
const membershipA = {
  userId: sessionA.userId,
  accountId: accountA,
  role: 'agent',
  accountName: 'Synthetic Account A',
};

const validInput = {
  title: '  Synthetic Deal  ',
  value: 1234.5,
  currency: 'BRL',
  pipelineId: pipelineA,
  stageId: stageA,
  contactId: contactA,
  assignedTo: profileA,
  notes: '  Synthetic note  ',
  expectedCloseDate: '2026-10-30',
};

function setupTransactions({
  role = 'agent',
  insertedRows = [{ id: createdDeal }],
}: {
  role?: string;
  insertedRows?: Record<string, unknown>[];
} = {}) {
  const transactionQuery = vi.fn(
    async (...args: [sql: string, values?: readonly unknown[]]) => {
      const [sql] = args;
      if (sql.includes('set_config')) return { rows: [], rowCount: 1 };
      if (sql.includes('INNER JOIN public.accounts')) {
        return { rows: [{ ...membershipA, role }], rowCount: 1 };
      }
      if (sql.includes('INSERT INTO public.deals')) {
        return { rows: insertedRows, rowCount: insertedRows.length };
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

describe('PostgreSQL pipeline deal-create repository', () => {
  beforeEach(() => {
    mocks.withTransaction.mockReset();
  });

  it('requires a verified session before opening a transaction', async () => {
    const repository = createPostgresPipelineDealCreateRepository(
      async () => null
    );

    await expect(repository.createDeal(validInput)).rejects.toEqual(
      new AppError('unauthorized')
    );
    expect(mocks.withTransaction).not.toHaveBeenCalled();
  });

  it('denies viewers before attempting the insert', async () => {
    const query = setupTransactions({ role: 'viewer' });
    const repository = createPostgresPipelineDealCreateRepository(
      async () => sessionA
    );

    await expect(repository.createDeal(validInput)).rejects.toEqual(
      new AppError('forbidden')
    );
    expect(
      query.mock.calls.some(([sql]) => sql.includes('INSERT INTO public.deals'))
    ).toBe(false);
  });

  it('validates values and relationships before opening the insert transaction', async () => {
    const query = setupTransactions();
    const repository = createPostgresPipelineDealCreateRepository(
      async () => sessionA
    );

    const invalidInputs = [
      { ...validInput, title: '  ' },
      { ...validInput, value: Number.NaN },
      { ...validInput, value: 10_000_000_000 },
      { ...validInput, currency: 'United States' },
      { ...validInput, pipelineId: 'invalid' },
      { ...validInput, stageId: 'invalid' },
      { ...validInput, contactId: 'invalid' },
      { ...validInput, assignedTo: 'invalid' },
      { ...validInput, expectedCloseDate: '2026-02-31' },
      { ...validInput, notes: 42 },
    ];

    for (const input of invalidInputs) {
      await expect(repository.createDeal(input as never)).rejects.toEqual(
        new AppError('bad_request')
      );
    }
    expect(
      query.mock.calls.some(([sql]) => sql.includes('INSERT INTO public.deals'))
    ).toBe(false);
  });

  it('derives identity, inserts only bound values and sets status open', async () => {
    const query = setupTransactions();
    const repository = createPostgresPipelineDealCreateRepository(
      async () => sessionA
    );

    await expect(repository.createDeal(validInput)).resolves.toBe(createdDeal);

    const insert = query.mock.calls.find(([sql]) =>
      sql.includes('INSERT INTO public.deals')
    );
    expect(insert?.[0]).toContain('SELECT $1, $2, p.id, stage.id, contact.id');
    expect(insert?.[0]).toContain("'open'");
    expect(insert?.[0]).not.toContain('public.profiles AS pipeline_creator');
    expect(insert?.[0]).toContain('p.account_id = $2');
    expect(insert?.[0]).toContain('stage.pipeline_id = p.id');
    expect(insert?.[0]).toContain('contact.account_id = p.account_id');
    expect(insert?.[0]).toContain('assignee.account_id = p.account_id');
    expect(insert?.[1]).toEqual([
      sessionA.userId,
      accountA,
      pipelineA,
      stageA,
      contactA,
      profileA,
      'Synthetic Deal',
      1234.5,
      'BRL',
      'Synthetic note',
      '2026-10-30',
    ]);
    expect(
      query.mock.calls.some(
        ([sql, values]) =>
          sql === "SELECT set_config('request.jwt.claim.sub', $1, true)" &&
          values?.[0] === sessionA.userId
      )
    ).toBe(true);
  });

  it('supports a nullable assignee, notes and close date', async () => {
    const query = setupTransactions();
    const repository = createPostgresPipelineDealCreateRepository(
      async () => sessionA
    );

    await repository.createDeal({
      ...validInput,
      assignedTo: null,
      notes: '   ',
      expectedCloseDate: null,
    });

    const insert = query.mock.calls.find(([sql]) =>
      sql.includes('INSERT INTO public.deals')
    );
    expect(insert?.[1]?.slice(5)).toEqual([
      null,
      'Synthetic Deal',
      1234.5,
      'BRL',
      null,
      null,
    ]);
  });

  it('returns not found when a related record is missing or foreign', async () => {
    setupTransactions({ insertedRows: [] });
    const repository = createPostgresPipelineDealCreateRepository(
      async () => sessionA
    );

    await expect(repository.createDeal(validInput)).rejects.toEqual(
      new AppError('not_found')
    );
  });

  it('fails closed if the database returns an invalid ID', async () => {
    setupTransactions({ insertedRows: [{ id: 'invalid' }] });
    const repository = createPostgresPipelineDealCreateRepository(
      async () => sessionA
    );

    await expect(repository.createDeal(validInput)).rejects.toEqual(
      new AppError('db_error')
    );
  });

  it('propagates safe database errors without driver details', async () => {
    const databaseFailure = new AppError('db_error');
    mocks.withTransaction
      .mockResolvedValueOnce(dbSuccess(membershipA))
      .mockResolvedValueOnce(dbFailure(databaseFailure));
    const repository = createPostgresPipelineDealCreateRepository(
      async () => sessionA
    );

    await expect(repository.createDeal(validInput)).rejects.toBe(
      databaseFailure
    );
  });
});
