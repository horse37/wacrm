import assert from 'node:assert/strict';
import { AppError } from '../../src/lib/db/errors.ts';
import { queryDb } from '../../src/lib/db/postgres-client.ts';
import { getPostgresPool } from '../../src/lib/db/postgres-pool.ts';
import { createPostgresAccountInvitationsRepository } from '../../src/lib/repositories/account-invitations.ts';

const ownerA = '00000000-0000-4000-8000-000000000001';
const ownerB = '00000000-0000-4000-8000-000000000002';
const viewerA = '00000000-0000-4000-8000-000000000003';
const pool = getPostgresPool();

function requireSuccess(result, label) {
  if (!result.ok) throw new Error(`${label} failed with ${result.error.code}`);
  return result.data;
}

try {
  const runtime = requireSuccess(
    await queryDb(
      'SELECT current_user AS role, rolbypassrls FROM pg_roles WHERE rolname = current_user'
    ),
    'runtime role probe'
  );
  assert.deepEqual(runtime.rows, [
    { role: 'wacrm_account_invitations_runtime', rolbypassrls: false },
  ]);

  const repositoryA = createPostgresAccountInvitationsRepository(async () => ({
    userId: ownerA,
  }));
  const invitationsA = await repositoryA.listOutstanding();
  assert.deepEqual(
    invitationsA.map(({ id }) => id),
    [
      '20000000-0000-4000-8000-000000000001',
      '20000000-0000-4000-8000-000000000002',
    ]
  );
  assert.deepEqual(Object.keys(invitationsA[0]).sort(), [
    'accepted_at',
    'accepted_by_user_id',
    'created_at',
    'created_by_user_id',
    'expires_at',
    'id',
    'label',
    'role',
  ]);
  assert.equal(
    invitationsA.some(({ label }) =>
      [
        'Synthetic expired invitation A',
        'Synthetic accepted invitation A',
      ].includes(label)
    ),
    false
  );

  const repositoryViewerA = createPostgresAccountInvitationsRepository(
    async () => ({ userId: viewerA })
  );
  await assert.rejects(
    repositoryViewerA.listOutstanding(),
    (error) => error instanceof AppError && error.code === 'forbidden'
  );

  const repositoryB = createPostgresAccountInvitationsRepository(async () => ({
    userId: ownerB,
  }));
  const invitationsB = await repositoryB.listOutstanding();
  assert.deepEqual(
    invitationsB.map(({ id }) => id),
    ['20000000-0000-4000-8000-000000000005']
  );

  const noSessionRepository = createPostgresAccountInvitationsRepository(
    async () => null
  );
  await assert.rejects(
    noSessionRepository.listOutstanding(),
    (error) => error instanceof AppError && error.code === 'unauthorized'
  );

  const pooledIdentity = requireSuccess(
    await queryDb('SELECT auth.uid()::text AS user_id'),
    'pooled identity reset probe'
  );
  assert.deepEqual(pooledIdentity.rows, [{ user_id: null }]);

  console.log(
    'PostgreSQL account invitations integration SUCCESS: verified admin scope, account isolation, pending/expiry filters, deterministic ordering, token_hash exclusion, missing-session denial, and transaction-local identity cleanup.'
  );
} finally {
  await pool.end();
}
