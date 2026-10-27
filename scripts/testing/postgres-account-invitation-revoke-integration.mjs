import assert from 'node:assert/strict';
import { AppError } from '../../src/lib/db/errors.ts';
import { queryDb, withTransaction } from '../../src/lib/db/postgres-client.ts';
import { getPostgresPool } from '../../src/lib/db/postgres-pool.ts';
import { createPostgresAccountInvitationsRepository } from '../../src/lib/repositories/account-invitations.ts';

const ownerA = '00000000-0000-4000-8000-000000000001';
const ownerB = '00000000-0000-4000-8000-000000000002';
const agentA = '00000000-0000-4000-8000-000000000003';
const viewerA = '00000000-0000-4000-8000-000000000004';
const invitationA = '20000000-0000-4000-8000-000000000001';
const invitationB = '20000000-0000-4000-8000-000000000002';
const pool = getPostgresPool();

function requireSuccess(result, label) {
  if (!result.ok) throw new Error(`${label} failed with ${result.error.code}`);
  return result.data;
}

async function visibleInvitationIds(userId) {
  return requireSuccess(
    await withTransaction(async (transaction) => {
      await transaction.query(
        "SELECT set_config('request.jwt.claim.sub', $1, true)",
        [userId]
      );
      const result = await transaction.query(
        'SELECT id::text AS id FROM public.account_invitations ORDER BY id'
      );
      return result.rows.map((row) => row.id);
    }),
    'visible invitations probe'
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
    { role: 'wacrm_account_invitation_revoke_runtime', rolbypassrls: false },
  ]);

  const repositoryA = createPostgresAccountInvitationsRepository(async () => ({
    userId: ownerA,
  }));
  assert.equal(await repositoryA.revoke(invitationA), true);
  assert.deepEqual(await visibleInvitationIds(ownerA), []);
  assert.deepEqual(await visibleInvitationIds(ownerB), [invitationB]);
  assert.equal(await repositoryA.revoke(invitationA), false);

  const repositoryB = createPostgresAccountInvitationsRepository(async () => ({
    userId: ownerB,
  }));
  assert.equal(await repositoryB.revoke(invitationA), false);
  assert.deepEqual(await visibleInvitationIds(ownerB), [invitationB]);

  for (const userId of [agentA, viewerA]) {
    const repository = createPostgresAccountInvitationsRepository(async () => ({
      userId,
    }));
    await assert.rejects(
      repository.revoke(invitationB),
      (error) => error instanceof AppError && error.code === 'forbidden'
    );
  }

  const noSessionRepository = createPostgresAccountInvitationsRepository(
    async () => null
  );
  await assert.rejects(
    noSessionRepository.revoke(invitationB),
    (error) => error instanceof AppError && error.code === 'unauthorized'
  );

  const pooledIdentity = requireSuccess(
    await queryDb('SELECT auth.uid()::text AS user_id'),
    'pooled identity reset probe'
  );
  assert.deepEqual(pooledIdentity.rows, [{ user_id: null }]);

  console.log(
    'PostgreSQL account invitation revoke integration SUCCESS: admin enforcement, guard-derived account scope, hard-delete, missing/cross-account not-found behavior, two-account isolation, missing-session denial, and transaction-local identity cleanup.'
  );
} finally {
  await pool.end();
}
