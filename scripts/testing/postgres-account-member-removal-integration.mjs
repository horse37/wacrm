import assert from 'node:assert/strict';
import { AppError } from '../../src/lib/db/errors.ts';
import { queryDb, withTransaction } from '../../src/lib/db/postgres-client.ts';
import { getPostgresPool } from '../../src/lib/db/postgres-pool.ts';
import { createPostgresAccountMemberRemovalRepository } from '../../src/lib/repositories/account-member-removal.ts';

const ownerA = '00000000-0000-4000-8000-000000000001';
const ownerB = '00000000-0000-4000-8000-000000000002';
const memberA = '00000000-0000-4000-8000-000000000003';
const viewerA = '00000000-0000-4000-8000-000000000004';
const adminA = '00000000-0000-4000-8000-000000000005';
const agentA = '00000000-0000-4000-8000-000000000006';
const accountA = '10000000-0000-4000-8000-000000000001';
const pool = getPostgresPool();

function requireSuccess(result, label) {
  if (!result.ok) throw new Error(`${label} failed with ${result.error.code}`);
  return result.data;
}

async function readProfile(userId, targetUserId) {
  return requireSuccess(
    await withTransaction(async (transaction) => {
      await transaction.query(
        "SELECT set_config('request.jwt.claim.sub', $1, true)",
        [userId]
      );
      const result = await transaction.query(
        `SELECT
           profile.user_id::text AS user_id,
           profile.account_id::text AS account_id,
           profile.account_role::text AS role,
           account.owner_user_id::text AS owner_user_id,
           account.name
         FROM public.profiles AS profile
         INNER JOIN public.accounts AS account ON account.id = profile.account_id
         WHERE profile.user_id = $1`,
        [targetUserId]
      );
      return result.rows;
    }),
    'profile probe'
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
    { role: 'wacrm_account_member_removal_runtime', rolbypassrls: false },
  ]);

  const repositoryAdminA = createPostgresAccountMemberRemovalRepository(
    async () => ({ userId: adminA })
  );
  const newPersonalAccountId = await repositoryAdminA.removeMember(memberA);
  assert.match(
    newPersonalAccountId,
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
  );
  assert.notEqual(newPersonalAccountId, accountA);
  assert.deepEqual(await readProfile(memberA, memberA), [
    {
      user_id: memberA,
      account_id: newPersonalAccountId,
      role: 'owner',
      owner_user_id: memberA,
      name: 'Synthetic Member A',
    },
  ]);
  assert.deepEqual(await readProfile(ownerA, ownerA), [
    {
      user_id: ownerA,
      account_id: accountA,
      role: 'owner',
      owner_user_id: ownerA,
      name: 'Synthetic Account A',
    },
  ]);

  await assert.rejects(
    repositoryAdminA.removeMember(ownerA),
    (error) => error instanceof AppError && error.code === 'forbidden'
  );
  await assert.rejects(
    repositoryAdminA.removeMember(adminA),
    (error) => error instanceof AppError && error.code === 'forbidden'
  );
  await assert.rejects(
    repositoryAdminA.removeMember('not-a-uuid'),
    (error) => error instanceof AppError && error.code === 'forbidden'
  );
  await assert.rejects(
    repositoryAdminA.removeMember(memberA),
    (error) => error instanceof AppError && error.code === 'not_found'
  );
  await assert.rejects(
    repositoryAdminA.removeMember(ownerB),
    (error) => error instanceof AppError && error.code === 'not_found'
  );

  const repositoryB = createPostgresAccountMemberRemovalRepository(
    async () => ({ userId: ownerB })
  );
  await assert.rejects(
    repositoryB.removeMember(viewerA),
    (error) => error instanceof AppError && error.code === 'not_found'
  );
  assert.deepEqual(await readProfile(ownerB, ownerB), [
    {
      user_id: ownerB,
      account_id: '10000000-0000-4000-8000-000000000002',
      role: 'owner',
      owner_user_id: ownerB,
      name: 'Synthetic Account B',
    },
  ]);

  for (const userId of [agentA, viewerA]) {
    const repository = createPostgresAccountMemberRemovalRepository(
      async () => ({ userId })
    );
    await assert.rejects(
      repository.removeMember(viewerA),
      (error) => error instanceof AppError && error.code === 'forbidden'
    );
  }

  const noSessionRepository = createPostgresAccountMemberRemovalRepository(
    async () => null
  );
  await assert.rejects(
    noSessionRepository.removeMember(viewerA),
    (error) => error instanceof AppError && error.code === 'unauthorized'
  );

  const pooledIdentity = requireSuccess(
    await queryDb('SELECT auth.uid()::text AS user_id'),
    'pooled identity reset probe'
  );
  assert.deepEqual(pooledIdentity.rows, [{ user_id: null }]);

  console.log(
    'PostgreSQL account member removal integration SUCCESS: admin enforcement, verified account scoping, existing RPC authorization, owner/self restrictions, cross-account non-disclosure, personal account creation and profile reassignment, missing-session denial, and transaction-local identity cleanup.'
  );
} finally {
  await pool.end();
}
