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
import { createPostgresAutomationPendingClaimRepository } from './automation-pending-claim';

const asOf = new Date('2026-10-20T12:00:00.000Z');
const writerA = {
  userId: '00000000-0000-4000-8000-000000000001',
  accountId: '10000000-0000-4000-8000-000000000001',
};
const claimedRows = [
  {
    id: '40000000-0000-4000-8000-000000000001',
    automation_id: '30000000-0000-4000-8000-000000000001',
    account_id: '10000000-0000-4000-8000-000000000001',
    user_id: '00000000-0000-4000-8000-000000000001',
    contact_id: '50000000-0000-4000-8000-000000000001',
    log_id: '60000000-0000-4000-8000-000000000001',
    parent_step_id: '70000000-0000-4000-8000-000000000001',
    branch: 'yes',
    next_step_position: 4,
    context: { message_text: 'Synthetic only', vars: { source: 'fixture' } },
  },
];

function setupTransaction(rows: unknown[] = claimedRows) {
  const query = vi
    .fn()
    .mockResolvedValueOnce({ rows: [], rowCount: null })
    .mockResolvedValueOnce({ rows, rowCount: rows.length });
  const transaction = { query } as unknown as DbTransaction;

  mocks.withTransaction.mockImplementation(async (operation) => {
    try {
      return dbSuccess(await operation(transaction));
    } catch (error) {
      return dbFailure(toAppError(error));
    }
  });

  return query;
}

describe('PostgreSQL automation pending-execution claim repository', () => {
  beforeEach(() => {
    mocks.withTransaction.mockReset();
  });

  it('claims and projects rows needed by the resume engine', async () => {
    const query = setupTransaction();
    const repository = createPostgresAutomationPendingClaimRepository();

    await expect(repository.claimDue(writerA, asOf)).resolves.toEqual(
      claimedRows
    );

    expect(mocks.withTransaction).toHaveBeenCalledTimes(1);
    expect(query).toHaveBeenCalledTimes(2);
    expect(query.mock.calls[0][0]).toBe(
      "SELECT set_config('request.jwt.claim.sub', $1, true)"
    );
    expect(query.mock.calls[0][1]).toEqual([writerA.userId]);
    expect(query.mock.calls[1][1]).toEqual([writerA.accountId, asOf, 50]);
    const sql = query.mock.calls[1][0] as string;
    expect(sql).toContain('FOR UPDATE SKIP LOCKED');
    expect(sql).toContain("status = 'pending'");
    expect(sql).toContain('account_id = $1');
    expect(sql).toContain('run_at <= $2');
    expect(sql).toContain("SET status = 'running'");
    expect(sql).toContain('pending.account_id = $1');
    expect(sql).toContain('ORDER BY run_at ASC, id ASC');
    expect(sql).not.toContain('trigger_config');
    expect(sql).not.toContain('created_at');
  });

  it('supports a smaller requested batch size', async () => {
    const query = setupTransaction([]);
    const repository = createPostgresAutomationPendingClaimRepository();

    await expect(repository.claimDue(writerA, asOf, 3)).resolves.toEqual([]);
    expect(query.mock.calls[1][1]).toEqual([writerA.accountId, asOf, 3]);
  });

  it.each([
    ['non-Date input', null as unknown as Date, 50],
    ['invalid date', new Date(Number.NaN), 50],
    ['zero limit', asOf, 0],
    ['over-maximum limit', asOf, 51],
    ['fractional limit', asOf, 1.5],
  ])('rejects %s before opening a transaction', async (_label, date, limit) => {
    const repository = createPostgresAutomationPendingClaimRepository();

    await expect(repository.claimDue(writerA, date, limit)).rejects.toEqual(
      new AppError('bad_request')
    );
    expect(mocks.withTransaction).not.toHaveBeenCalled();
  });

  it.each([
    ['missing context', undefined],
    ['malformed user ID', { ...writerA, userId: 'invalid' }],
    ['malformed account ID', { ...writerA, accountId: 'invalid' }],
  ])(
    'rejects %s before opening a transaction',
    async (_label, writerContext) => {
      const repository = createPostgresAutomationPendingClaimRepository();

      await expect(
        repository.claimDue(
          writerContext as Parameters<typeof repository.claimDue>[0],
          asOf
        )
      ).rejects.toEqual(new AppError('bad_request'));
      expect(mocks.withTransaction).not.toHaveBeenCalled();
    }
  );

  it.each([
    ['branch', { ...claimedRows[0], branch: 'sideways' }],
    ['UUID', { ...claimedRows[0], account_id: null }],
    ['context', { ...claimedRows[0], context: [] }],
    [
      'context message_text',
      { ...claimedRows[0], context: { message_text: { invalid: true } } },
    ],
    ['context vars', { ...claimedRows[0], context: { vars: 'invalid' } }],
    ['step position', { ...claimedRows[0], next_step_position: -1 }],
  ])(
    'rejects malformed database %s as a safe database error',
    async (_field, row) => {
      setupTransaction([row]);
      const repository = createPostgresAutomationPendingClaimRepository();

      await expect(repository.claimDue(writerA, asOf)).rejects.toEqual(
        new AppError('db_error')
      );
    }
  );

  it('propagates database failures without driver details', async () => {
    const failure = new AppError('db_error');
    mocks.withTransaction.mockResolvedValueOnce(dbFailure(failure));
    const repository = createPostgresAutomationPendingClaimRepository();

    await expect(repository.claimDue(writerA, asOf)).rejects.toBe(failure);
  });
});
