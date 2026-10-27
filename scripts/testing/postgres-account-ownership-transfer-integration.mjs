import assert from 'node:assert/strict';
import { AppError } from '../../src/lib/db/errors.ts';
import { queryDb, withTransaction } from '../../src/lib/db/postgres-client.ts';
import { getPostgresPool } from '../../src/lib/db/postgres-pool.ts';
import { createPostgresAccountOwnershipTransferRepository } from '../../src/lib/repositories/account-ownership-transfer.ts';

const ownerA = '00000000-0000-4000-8000-000000000001';
const ownerB = '00000000-0000-4000-8000-000000000002';
const agentA = '00000000-0000-4000-8000-000000000003';
const viewerA = '00000000-0000-4000-8000-000000000004';
const adminA = '00000000-0000-4000-8000-000000000005';
const accountA = '10000000-0000-4000-8000-000000000001';
const accountB = '10000000-0000-4000-8000-000000000002';
const pool = getPostgresPool();

function requireSuccess(result, label) {
  if (!result.ok) throw new Error(`${label} failed with ${result.error.code}`);
  return result.data;
}

async function readAccountState(userId, accountId) {
  return requireSuccess(
    await withTransaction(async (transaction) => {
      await transaction.query(
        "SELECT set_config('request.jwt.claim.sub', $1, true)",
        [userId]
      );
      const result = await transaction.query(
        `SELECT
           profile.user_id::text AS user_id,
           profile.account_role::text AS role,
           account.owner_user_id::text AS owner_user_id
         FROM public.profiles AS profile
         INNER JOIN public.accounts AS account ON account.id = profile.account_id
         WHERE account.id = $1
         ORDER BY profile.user_id`,
        [accountId]
      );
      return result.rows;
    }),
    'account state probe'
  );
}

try {
  const runtime = requireSuccess(
    await queryDb(
      'SELECT current_user AS role, rolbypassrls FROM pg_roles WHERE rolname = current_user'
    ),
    'runtime role probe'
  );
  assert.deepEqual(runtime.rows, [
    { role: 'wacrm_account_ownership_transfer_runtime', rolbypassrls: false },
  ]);

  const repositoryOwnerA = createPostgresAccountOwnershipTransferRepository(
    async () => ({ userId: ownerA })
  );
  await assert.rejects(
    repositoryOwnerA.transferTo(ownerA.toUpperCase()),
    (error) => error instanceof AppError && error.code === 'forbidden'
  );
  await assert.rejects(
    repositoryOwnerA.transferTo('not-a-uuid'),
    (error) => error instanceof AppError && error.code === 'forbidden'
  );
  await assert.rejects(
    repositoryOwnerA.transferTo(ownerB),
    (error) => error instanceof AppError && error.code === 'not_found'
  );
  await assert.rejects(
    repositoryOwnerA.transferTo('00000000-0000-4000-8000-000000000099'),
    (error) => error instanceof AppError && error.code === 'not_found'
  );

  const repositoryAdminA = createPostgresAccountOwnershipTransferRepository(
    async () => ({ userId: adminA })
  );
  await assert.rejects(
    repositoryAdminA.transferTo(agentA),
    (error) => error instanceof AppError && error.code === 'forbidden'
  );

  const repositoryWithoutSession =
    createPostgresAccountOwnershipTransferRepository(async () => null);
  await assert.rejects(
    repositoryWithoutSession.transferTo(agentA),
    (error) => error instanceof AppError && error.code === 'unauthorized'
  );

  await repositoryOwnerA.transferTo(agentA);
  assert.deepEqual(await readAccountState(ownerA, accountA), [
    {
      user_id: ownerA,
      role: 'admin',
      owner_user_id: agentA,
    },
    {
      user_id: agentA,
      role: 'owner',
      owner_user_id: agentA,
    },
    {
      user_id: viewerA,
      role: 'viewer',
      owner_user_id: agentA,
    },
    {
      user_id: adminA,
      role: 'admin',
      owner_user_id: agentA,
    },
  ]);
  assert.deepEqual(await readAccountState(ownerB, accountB), [
    {
      user_id: ownerB,
      role: 'owner',
      owner_user_id: ownerB,
    },
  ]);

  await assert.rejects(
    repositoryOwnerA.transferTo(viewerA),
    (error) => error instanceof AppError && error.code === 'forbidden'
  );

  const pooledIdentity = requireSuccess(
    await queryDb('SELECT auth.uid()::text AS user_id'),
    'pooled identity reset probe'
  );
  assert.deepEqual(pooledIdentity.rows, [{ user_id: null }]);

  console.log(
    'PostgreSQL account ownership transfer integration SUCCESS: owner enforcement, verified account scoping, existing RPC authorization, self/missing/cross-account restrictions, atomic role and owner-pointer updates, second-account isolation, and transaction-local identity cleanup.'
  );
} finally {
  await pool.end();
}
