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
import { createPostgresInvitationPreviewRepository } from './invitation-preview';

const tokenHash = 'a'.repeat(64);
const preview = {
  ok: true,
  account_name: 'Synthetic Account A',
  role: 'agent',
  expires_at: '2026-10-26T12:00:00.000Z',
};

function setupTransactions(previewValue: unknown = preview) {
  const transactionQuery = vi.fn(
    async (...args: [sql: string, values?: readonly unknown[]]) => {
      void args;
      return { rows: [{ preview: previewValue }], rowCount: 1 };
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

describe('PostgreSQL invitation preview repository', () => {
  beforeEach(() => {
    mocks.withTransaction.mockReset();
  });

  it('returns not_found for malformed hashes without a database call', async () => {
    const repository = createPostgresInvitationPreviewRepository();

    await expect(
      repository.peekByTokenHash('plaintext invite token')
    ).resolves.toEqual({ ok: false, reason: 'not_found' });
    expect(mocks.withTransaction).not.toHaveBeenCalled();
  });

  it('binds only the normalized SHA-256 digest and sanitizes success metadata', async () => {
    const query = setupTransactions({
      ...preview,
      token_hash: tokenHash,
      accepted_by_user_id: 'private-user-id',
    });
    const repository = createPostgresInvitationPreviewRepository();

    await expect(
      repository.peekByTokenHash(tokenHash.toUpperCase())
    ).resolves.toEqual(preview);

    const call = query.mock.calls[0];
    expect(call[0]).toContain('public.peek_invitation($1::text)');
    expect(call[1]).toEqual([tokenHash]);
  });

  it.each(['not_found', 'expired', 'used'] as const)(
    'preserves the %s result from the RPC',
    async (reason) => {
      setupTransactions({ ok: false, reason, token_hash: 'never-return-this' });
      const repository = createPostgresInvitationPreviewRepository();

      await expect(repository.peekByTokenHash(tokenHash)).resolves.toEqual({
        ok: false,
        reason,
      });
    }
  );

  it.each([
    null,
    { ok: 'yes', account_name: 'bad', role: 'agent', expires_at: '2026-10-26' },
    {
      ok: true,
      account_name: 'bad role',
      role: 'root',
      expires_at: '2026-10-26',
    },
    { ok: true, account_name: 'bad date', role: 'agent', expires_at: 'soon' },
    { ok: false, reason: 'private detail' },
  ])('rejects malformed RPC response %j safely', async (previewValue) => {
    setupTransactions(previewValue);
    const repository = createPostgresInvitationPreviewRepository();

    await expect(repository.peekByTokenHash(tokenHash)).rejects.toEqual(
      new AppError('db_error')
    );
  });

  it('maps database failures to the safe database error', async () => {
    const databaseFailure = new AppError('db_error');
    mocks.withTransaction.mockResolvedValueOnce(dbFailure(databaseFailure));
    const repository = createPostgresInvitationPreviewRepository();

    await expect(repository.peekByTokenHash(tokenHash)).rejects.toBe(
      databaseFailure
    );
  });
});
