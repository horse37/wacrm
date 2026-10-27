import assert from 'node:assert/strict';
import { AppError } from '../../src/lib/db/errors.ts';
import { queryDb, withTransaction } from '../../src/lib/db/postgres-client.ts';
import { getPostgresPool } from '../../src/lib/db/postgres-pool.ts';
import { createPostgresAccountMemberRoleRepository } from '../../src/lib/repositories/account-member-role.ts';

const ownerA = '00000000-0000-4000-8000-000000000001';
const ownerB = '00000000-0000-4000-8000-000000000002';
const agentA = '00000000-0000-4000-8000-000000000003';
const viewerA = '00000000-0000-4000-8000-000000000004';
const adminA = '00000000-0000-4000-8000-000000000005';
const pool = getPostgresPool();

function requireSuccess(result, label) {
  if (!result.ok) throw new Error(`${label} failed with ${result.error.code}`);
  return result.data;
}

async function readRole(userId, targetUserId) {
  return requireSuccess(
    await withTransaction(async (transaction) => {
      await transaction.query(
        "SELECT set_config('request.jwt.claim.sub', $1, true)",
        [userId]
      );
      const result = await transaction.query(
        `SELECT account_role::text AS role
         FROM public.profiles
         WHERE user_id = $1`,
        [targetUserId]
      );
      return result.rows;
    }),
    'member role probe'
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
    { role: 'wacrm_account_member_role_runtime', rolbypassrls: false },
  ]);

  const repositoryAdminA = createPostgresAccountMemberRoleRepository(
    async () => ({ userId: adminA })
  );
  await repositoryAdminA.setRole(agentA, 'viewer');
  assert.deepEqual(await readRole(ownerA, agentA), [{ role: 'viewer' }]);

  await assert.rejects(
    repositoryAdminA.setRole(ownerA, 'viewer'),
    (error) => error instanceof AppError && error.code === 'forbidden'
  );
  await assert.rejects(
    repositoryAdminA.setRole(adminA, 'viewer'),
    (error) => error instanceof AppError && error.code === 'forbidden'
  );
  await assert.rejects(
    repositoryAdminA.setRole(ownerB, 'viewer'),
    (error) => error instanceof AppError && error.code === 'not_found'
  );

  const repositoryB = createPostgresAccountMemberRoleRepository(async () => ({
    userId: ownerB,
  }));
  await assert.rejects(
    repositoryB.setRole(agentA, 'viewer'),
    (error) => error instanceof AppError && error.code === 'not_found'
  );
  assert.deepEqual(await readRole(ownerB, ownerB), [{ role: 'owner' }]);

  for (const userId of [agentA, viewerA]) {
    const repository = createPostgresAccountMemberRoleRepository(async () => ({
      userId,
    }));
    await assert.rejects(
      repository.setRole(viewerA, 'agent'),
      (error) => error instanceof AppError && error.code === 'forbidden'
    );
  }

  const noSessionRepository = createPostgresAccountMemberRoleRepository(
    async () => null
  );
  await assert.rejects(
    noSessionRepository.setRole(agentA, 'viewer'),
    (error) => error instanceof AppError && error.code === 'unauthorized'
  );

  await assert.rejects(
    repositoryAdminA.setRole(agentA, 'owner'),
    (error) => error instanceof AppError && error.code === 'forbidden'
  );

  const pooledIdentity = requireSuccess(
    await queryDb('SELECT auth.uid()::text AS user_id'),
    'pooled identity reset probe'
  );
  assert.deepEqual(pooledIdentity.rows, [{ user_id: null }]);

  console.log(
    'PostgreSQL account member role integration SUCCESS: admin enforcement, verified account scoping, existing RPC authorization, owner/self restrictions, cross-account non-disclosure, role update, missing-session denial, and transaction-local identity cleanup.'
  );
} finally {
  await pool.end();
}
