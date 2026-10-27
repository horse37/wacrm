import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AppError } from '../db/errors';

const mocks = vi.hoisted(() => {
  const client = {
    query: vi.fn(),
    release: vi.fn(),
  };
  const pool = {
    connect: vi.fn(),
  };

  return {
    client,
    pool,
    requireAccount: vi.fn(),
  };
});

vi.mock('server-only', () => ({}));
vi.mock('../auth/postgres-account-guard', () => ({
  createDefaultPostgresAccountGuards: () => ({
    requireAccount: mocks.requireAccount,
  }),
}));
vi.mock('../db/postgres-pool', () => ({
  getPostgresPool: () => mocks.pool,
}));

import { createPostgresInvitationRedemptionRepository } from './invitation-redemption';

const tokenHash = 'a'.repeat(64);
const accountContext = {
  userId: '00000000-0000-4000-8000-000000000001',
  accountId: '10000000-0000-4000-8000-000000000001',
  role: 'owner' as const,
  account: {
    id: '10000000-0000-4000-8000-000000000001',
    name: 'Synthetic Personal Account',
  },
};
const invitedAccountId = '10000000-0000-4000-8000-000000000002';

function setupTransaction(
  result: { rows: Array<{ account_id: unknown }>; rowCount: number | null } = {
    rows: [{ account_id: invitedAccountId }],
    rowCount: 1,
  },
  rpcError?: { code: string; routine?: string }
) {
  mocks.client.query.mockImplementation(async (sql: string) => {
    if (sql.includes('public.redeem_invitation')) {
      if (rpcError) {
        throw Object.assign(new Error('private database message'), rpcError);
      }
      return result;
    }
    return { rows: [], rowCount: 1 };
  });
}

describe('PostgreSQL invitation redemption repository', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.requireAccount.mockResolvedValue(accountContext);
    mocks.pool.connect.mockResolvedValue(mocks.client);
    mocks.client.query.mockResolvedValue({ rows: [], rowCount: 1 });
  });

  it('requires a verified caller before opening a redemption transaction', async () => {
    mocks.requireAccount.mockRejectedValue(new AppError('unauthorized'));
    const repository = createPostgresInvitationRedemptionRepository(
      async () => null
    );

    await expect(repository.redeemByTokenHash(tokenHash)).rejects.toEqual(
      new AppError('unauthorized')
    );
    expect(mocks.pool.connect).not.toHaveBeenCalled();
  });

  it('rejects malformed hashes without invoking the RPC', async () => {
    const repository = createPostgresInvitationRedemptionRepository(
      async () => ({ userId: accountContext.userId })
    );

    await expect(
      repository.redeemByTokenHash('plaintext invite token')
    ).rejects.toEqual(new AppError('not_found'));
    expect(mocks.pool.connect).not.toHaveBeenCalled();
  });

  it('sets verified identity locally and binds only the normalized digest', async () => {
    setupTransaction();
    const repository = createPostgresInvitationRedemptionRepository(
      async () => ({ userId: accountContext.userId })
    );

    await expect(
      repository.redeemByTokenHash(tokenHash.toUpperCase())
    ).resolves.toBe(invitedAccountId);
    expect(mocks.client.query.mock.calls).toEqual([
      ['BEGIN'],
      [
        "SELECT set_config('request.jwt.claim.sub', $1, true)",
        [accountContext.userId],
      ],
      ['SELECT public.redeem_invitation($1::text) AS account_id', [tokenHash]],
      ['COMMIT'],
    ]);
    expect(mocks.client.release).toHaveBeenCalledTimes(1);
  });

  it.each([
    { sqlState: '22023', errorCode: 'bad_request' },
    { sqlState: '23505', errorCode: 'conflict' },
    {
      sqlState: '42501',
      errorCode: 'unauthorized',
      routine: 'exec_stmt_raise',
    },
    { sqlState: '42501', errorCode: 'db_error', routine: 'aclcheck_error' },
  ] as const)(
    'maps SQLSTATE $sqlState from $routine to $errorCode',
    async ({ sqlState, errorCode, routine }) => {
      setupTransaction(undefined, {
        code: sqlState,
        ...(routine ? { routine } : {}),
      });
      const repository = createPostgresInvitationRedemptionRepository(
        async () => ({ userId: accountContext.userId })
      );

      const error = await repository.redeemByTokenHash(tokenHash).then(
        () => undefined,
        (reason: unknown) => reason
      );

      expect(error).toMatchObject({
        code: errorCode,
        message: new AppError(errorCode).message,
      });
      if (errorCode === 'db_error') {
        expect(error).toMatchObject({ routine, sqlState: '42501' });
      }
      expect(String(error)).not.toContain('private database message');
      expect(mocks.client.query.mock.calls.map(([sql]) => sql)).toEqual([
        'BEGIN',
        "SELECT set_config('request.jwt.claim.sub', $1, true)",
        'SELECT public.redeem_invitation($1::text) AS account_id',
        'ROLLBACK',
      ]);
      expect(mocks.client.release).toHaveBeenCalledTimes(1);
    }
  );

  it.each([
    { rows: [], rowCount: 0 },
    { rows: [{ account_id: 'invalid-uuid' }], rowCount: 1 },
    {
      rows: [
        { account_id: invitedAccountId },
        { account_id: invitedAccountId },
      ],
      rowCount: 2,
    },
  ])('rejects malformed RPC result safely: %j', async (result) => {
    setupTransaction(result);
    const repository = createPostgresInvitationRedemptionRepository(
      async () => ({ userId: accountContext.userId })
    );

    await expect(repository.redeemByTokenHash(tokenHash)).rejects.toEqual(
      new AppError(result.rows.length > 1 ? 'conflict' : 'db_error')
    );
  });
});
