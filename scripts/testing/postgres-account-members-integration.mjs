import assert from 'node:assert/strict';
import { AppError } from '../../src/lib/db/errors.ts';
import { queryDb } from '../../src/lib/db/postgres-client.ts';
import { getPostgresPool } from '../../src/lib/db/postgres-pool.ts';
import { createPostgresAccountMembersRepository } from '../../src/lib/repositories/account-members.ts';

const userAdminA = '00000000-0000-4000-8000-000000000001';
const userOwnerB = '00000000-0000-4000-8000-000000000002';
const userViewerA = '00000000-0000-4000-8000-000000000003';
const accountA = '10000000-0000-4000-8000-000000000001';
const accountB = '10000000-0000-4000-8000-000000000002';
const pool = getPostgresPool();

try {
  const runtime = await queryDb(
    'SELECT current_user AS role, rolbypassrls FROM pg_roles WHERE rolname = current_user'
  );
  assert.equal(runtime.ok, true);
  assert.deepEqual(runtime.data.rows, [
    { role: 'wacrm_account_members_runtime', rolbypassrls: false },
  ]);

  const repositoryAdminA = createPostgresAccountMembersRepository(async () => ({
    userId: userAdminA,
  }));
  const adminMembers = await repositoryAdminA.list();
  assert.deepEqual(
    adminMembers.map((member) => member.user_id),
    [userAdminA, userViewerA]
  );
  assert.deepEqual(
    adminMembers.map((member) => member.email),
    ['admin-a@example.test', 'viewer-a@example.test']
  );

  const repositoryViewerA = createPostgresAccountMembersRepository(
    async () => ({ userId: userViewerA })
  );
  const viewerMembers = await repositoryViewerA.list();
  assert.deepEqual(
    viewerMembers.map((member) => member.user_id),
    [userAdminA, userViewerA]
  );
  assert.deepEqual(
    viewerMembers.map((member) => member.email),
    [null, null]
  );

  const repositoryOwnerB = createPostgresAccountMembersRepository(async () => ({
    userId: userOwnerB,
  }));
  const ownerMembers = await repositoryOwnerB.list();
  assert.deepEqual(
    ownerMembers.map((member) => member.user_id),
    [userOwnerB]
  );
  assert.deepEqual(
    ownerMembers.map((member) => member.email),
    ['owner-b@example.test']
  );
  assert.notEqual(accountA, accountB);

  const noSessionRepository = createPostgresAccountMembersRepository(
    async () => null
  );
  await assert.rejects(
    noSessionRepository.list(),
    (error) => error instanceof AppError && error.code === 'unauthorized'
  );

  const pooledIdentity = await queryDb('SELECT auth.uid()::text AS user_id');
  assert.equal(pooledIdentity.ok, true);
  assert.deepEqual(pooledIdentity.data.rows, [{ user_id: null }]);

  console.log(
    'PostgreSQL account members integration SUCCESS: explicit account scope, RLS isolation, role-sensitive email projection, missing-session denial, and transaction-local identity cleanup.'
  );
} finally {
  await pool.end();
}
