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
import { createPostgresPipelineDealDetailsUpdateRepository } from './pipeline-deal-details-update';

const sessionA = { userId: '00000000-0000-4000-8000-000000000001' };
const accountA = '10000000-0000-4000-8000-000000000001';
const dealA = '70000000-0000-4000-8000-000000000001';
const pipelineA = '50000000-0000-4000-8000-000000000001';
const stageA = '60000000-0000-4000-8000-000000000001';
const contactA = '40000000-0000-4000-8000-000000000001';
const profileA = '90000000-0000-4000-8000-000000000001';
const membershipA = {
  userId: sessionA.userId,
  accountId: accountA,
  role: 'agent',
  accountName: 'Synthetic Account A',
};

const validInput = {
  dealId: dealA,
  pipelineId: pipelineA,
  stageId: stageA,
  contactId: contactA,
  assignedTo: profileA,
  title: '  Updated Deal  ',
  value: 321.75,
  currency: 'BRL',
  notes: '  Updated note  ',
  expectedCloseDate: '2026-11-02',
};

function setupTransactions({
  role = 'agent',
  updatedRows = [{ id: dealA }],
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
      if (sql.includes('UPDATE public.deals AS d')) {
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

describe('PostgreSQL pipeline deal-details-update repository', () => {
  beforeEach(() => {
    mocks.withTransaction.mockReset();
  });

  it('requires a verified session before opening an update transaction', async () => {
    const repository = createPostgresPipelineDealDetailsUpdateRepository(
      async () => null
    );

    await expect(repository.updateDetails(validInput)).rejects.toEqual(
      new AppError('unauthorized')
    );
    expect(mocks.withTransaction).not.toHaveBeenCalled();
  });

  it('denies viewers before the update query', async () => {
    const query = setupTransactions({ role: 'viewer' });
    const repository = createPostgresPipelineDealDetailsUpdateRepository(
      async () => sessionA
    );

    await expect(repository.updateDetails(validInput)).rejects.toEqual(
      new AppError('forbidden')
    );
    expect(
      query.mock.calls.some(([sql]) => sql.includes('UPDATE public.deals AS d'))
    ).toBe(false);
  });

  it('validates IDs, field values, currency and calendar date', async () => {
    const query = setupTransactions();
    const repository = createPostgresPipelineDealDetailsUpdateRepository(
      async () => sessionA
    );

    const invalidInputs = [
      { ...validInput, dealId: 'invalid' },
      { ...validInput, pipelineId: 'invalid' },
      { ...validInput, stageId: 'invalid' },
      { ...validInput, contactId: 'invalid' },
      { ...validInput, assignedTo: 'invalid' },
      { ...validInput, title: '  ' },
      { ...validInput, value: Number.POSITIVE_INFINITY },
      { ...validInput, value: 10_000_000_000 },
      { ...validInput, currency: 'United States' },
      { ...validInput, notes: 42 },
      { ...validInput, expectedCloseDate: '2026-02-31' },
    ];

    for (const input of invalidInputs) {
      await expect(repository.updateDetails(input as never)).rejects.toEqual(
        new AppError('bad_request')
      );
    }
    expect(
      query.mock.calls.some(([sql]) => sql.includes('UPDATE public.deals AS d'))
    ).toBe(false);
  });

  it('updates only editable fields with bound account, deal and relationship IDs', async () => {
    const query = setupTransactions();
    const repository = createPostgresPipelineDealDetailsUpdateRepository(
      async () => sessionA
    );

    await expect(repository.updateDetails(validInput)).resolves.toBeUndefined();

    const update = query.mock.calls.find(([sql]) =>
      sql.includes('UPDATE public.deals AS d')
    );
    const setClause = update?.[0].split('WHERE')[0];
    expect(update?.[0]).toContain('SET title = $7');
    expect(update?.[0]).toContain('value = $8');
    expect(update?.[0]).toContain('currency = $9');
    expect(update?.[0]).toContain('stage_id = $4');
    expect(update?.[0]).toContain('contact_id = $5');
    expect(update?.[0]).toContain('assigned_to = $6');
    expect(update?.[0]).toContain('notes = $10');
    expect(update?.[0]).toContain('expected_close_date = $11');
    expect(update?.[0]).toContain('d.account_id = $1');
    expect(update?.[0]).toContain('d.id = $2');
    expect(update?.[0]).toContain('d.pipeline_id = $3');
    expect(update?.[0]).toContain('stage.pipeline_id = d.pipeline_id');
    expect(update?.[0]).toContain('contact.account_id = d.account_id');
    expect(update?.[0]).toContain('assignee.account_id = d.account_id');
    expect(setClause).not.toMatch(/\bstatus\s*=/i);
    expect(setClause).not.toMatch(/\buser_id\s*=/i);
    expect(setClause).not.toMatch(/\baccount_id\s*=/i);
    expect(setClause).not.toMatch(/\bpipeline_id\s*=/i);
    expect(update?.[1]).toEqual([
      accountA,
      dealA,
      pipelineA,
      stageA,
      contactA,
      profileA,
      'Updated Deal',
      321.75,
      'BRL',
      'Updated note',
      '2026-11-02',
    ]);
    expect(
      query.mock.calls.some(
        ([sql, values]) =>
          sql === "SELECT set_config('request.jwt.claim.sub', $1, true)" &&
          values?.[0] === sessionA.userId
      )
    ).toBe(true);
  });

  it('accepts nullable assignee, notes and close date', async () => {
    const query = setupTransactions();
    const repository = createPostgresPipelineDealDetailsUpdateRepository(
      async () => sessionA
    );

    await repository.updateDetails({
      ...validInput,
      assignedTo: null,
      notes: ' ',
      expectedCloseDate: null,
    });

    const update = query.mock.calls.find(([sql]) =>
      sql.includes('UPDATE public.deals AS d')
    );
    expect(update?.[1]?.slice(5)).toEqual([
      null,
      'Updated Deal',
      321.75,
      'BRL',
      null,
      null,
    ]);
  });

  it('returns not found for missing deals or invalid related rows', async () => {
    setupTransactions({ updatedRows: [] });
    const repository = createPostgresPipelineDealDetailsUpdateRepository(
      async () => sessionA
    );

    await expect(repository.updateDetails(validInput)).rejects.toEqual(
      new AppError('not_found')
    );
  });

  it('propagates safe database errors without driver details', async () => {
    const databaseFailure = new AppError('db_error');
    mocks.withTransaction
      .mockResolvedValueOnce(dbSuccess(membershipA))
      .mockResolvedValueOnce(dbFailure(databaseFailure));
    const repository = createPostgresPipelineDealDetailsUpdateRepository(
      async () => sessionA
    );

    await expect(repository.updateDetails(validInput)).rejects.toBe(
      databaseFailure
    );
  });
});
