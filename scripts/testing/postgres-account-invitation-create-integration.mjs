import assert from 'node:assert/strict';
import { AppError } from '../../src/lib/db/errors.ts';
import { queryDb, withTransaction } from '../../src/lib/db/postgres-client.ts';
import { getPostgresPool } from '../../src/lib/db/postgres-pool.ts';
import { createPostgresAccountInvitationsRepository } from '../../src/lib/repositories/account-invitations.ts';

const ownerA = '00000000-0000-4000-8000-000000000001';
const ownerB = '00000000-0000-4000-8000-000000000002';
const viewerA = '00000000-0000-4000-8000-000000000003';
const accountA = '10000000-0000-4000-8000-000000000001';
const accountB = '10000000-0000-4000-8000-000000000002';
const pool = getPostgresPool();

function requireSuccess(result, label) {
  if (!result.ok) throw new Error(`${label} failed with ${result.error.code}`);
  return result.data;
}

async function readStoredInvitation(userId, invitationId) {
  return requireSuccess(
    await withTransaction(async (transaction) => {
      await transaction.query(
        "SELECT set_config('request.jwt.claim.sub', $1, true)",
        [userId]
      );
      const result = await transaction.query(
        `SELECT
           account_id::text AS account_id,
           created_by_user_id::text AS created_by_user_id,
           token_hash
         FROM public.account_invitations
         WHERE id = $1`,
        [invitationId]
      );
      return result.rows;
    }),
    'stored invitation probe'
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
    { role: 'wacrm_account_invitation_create_runtime', rolbypassrls: false },
  ]);

  const hashA = 'a'.repeat(64);
  const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
  const repositoryA = createPostgresAccountInvitationsRepository(async () => ({
    userId: ownerA,
  }));
  const createdA = await repositoryA.create({
    role: 'agent',
    tokenHash: hashA,
    label: 'Synthetic invitation A',
    expiresAt,
  });
  assert.deepEqual(Object.keys(createdA).sort(), [
    'created_at',
    'expires_at',
    'id',
    'label',
    'role',
  ]);
  assert.equal(createdA.role, 'agent');
  assert.equal(createdA.label, 'Synthetic invitation A');
  assert.equal(createdA.expires_at, expiresAt.toISOString());
  assert.ok(Number.isFinite(Date.parse(createdA.created_at)));
  assert.equal(Object.hasOwn(createdA, 'token_hash'), false);

  assert.deepEqual(await readStoredInvitation(ownerA, createdA.id), [
    {
      account_id: accountA,
      created_by_user_id: ownerA,
      token_hash: hashA,
    },
  ]);
  assert.deepEqual(await readStoredInvitation(ownerB, createdA.id), []);

  const repositoryViewerA = createPostgresAccountInvitationsRepository(
    async () => ({ userId: viewerA })
  );
  await assert.rejects(
    repositoryViewerA.create({
      role: 'viewer',
      tokenHash: 'b'.repeat(64),
      label: 'Unauthorized synthetic invite',
      expiresAt,
    }),
    (error) => error instanceof AppError && error.code === 'forbidden'
  );

  const repositoryB = createPostgresAccountInvitationsRepository(async () => ({
    userId: ownerB,
  }));
  const createdB = await repositoryB.create({
    role: 'viewer',
    tokenHash: 'c'.repeat(64),
    label: 'Synthetic invitation B',
    expiresAt,
  });
  assert.deepEqual(await readStoredInvitation(ownerB, createdB.id), [
    {
      account_id: accountB,
      created_by_user_id: ownerB,
      token_hash: 'c'.repeat(64),
    },
  ]);
  assert.deepEqual(await readStoredInvitation(ownerA, createdB.id), []);

  const noSessionRepository = createPostgresAccountInvitationsRepository(
    async () => null
  );
  await assert.rejects(
    noSessionRepository.create({
      role: 'agent',
      tokenHash: 'd'.repeat(64),
      label: null,
      expiresAt,
    }),
    (error) => error instanceof AppError && error.code === 'unauthorized'
  );

  const pooledIdentity = requireSuccess(
    await queryDb('SELECT auth.uid()::text AS user_id'),
    'pooled identity reset probe'
  );
  assert.deepEqual(pooledIdentity.rows, [{ user_id: null }]);

  console.log(
    'PostgreSQL account invitation create integration SUCCESS: admin enforcement, guard-derived account/user scope, hash-only persistence, metadata-only response, two-account isolation, missing-session denial, and transaction-local identity cleanup.'
  );
} finally {
  await pool.end();
}
