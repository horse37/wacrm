import assert from 'node:assert/strict';
import { AppError } from '../../src/lib/db/errors.ts';
import { queryDb, withTransaction } from '../../src/lib/db/postgres-client.ts';
import { getPostgresPool } from '../../src/lib/db/postgres-pool.ts';
import { createPostgresAccountRepository } from '../../src/lib/repositories/accounts.ts';

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

async function readAccount(userId, accountId) {
  return requireSuccess(
    await withTransaction(async (transaction) => {
      await transaction.query(
        "SELECT set_config('request.jwt.claim.sub', $1, true)",
        [userId]
      );
      const result = await transaction.query(
        'SELECT id::text AS id, name, updated_at FROM public.accounts WHERE id = $1',
        [accountId]
      );
      return result.rows;
    }),
    'account read probe'
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
    { role: 'wacrm_account_rename_runtime', rolbypassrls: false },
  ]);

  const repositoryA = createPostgresAccountRepository(async () => ({
    userId: ownerA,
  }));
  const renamedA = await repositoryA.rename('Renamed Account A');
  assert.deepEqual(renamedA, {
    id: accountA,
    name: 'Renamed Account A',
  });
  const rowA = (await readAccount(ownerA, accountA))[0];
  assert.equal(rowA?.name, 'Renamed Account A');
  assert.ok(rowA?.updated_at instanceof Date);
  assert.ok(rowA.updated_at > new Date('2026-10-01T12:00:00.000Z'));

  const rowBBeforeRename = (await readAccount(ownerB, accountB))[0];
  assert.equal(rowBBeforeRename?.name, 'Synthetic Account B');

  const repositoryViewerA = createPostgresAccountRepository(async () => ({
    userId: viewerA,
  }));
  await assert.rejects(
    repositoryViewerA.rename('Unauthorized rename'),
    (error) => error instanceof AppError && error.code === 'forbidden'
  );

  const repositoryB = createPostgresAccountRepository(async () => ({
    userId: ownerB,
  }));
  const renamedB = await repositoryB.rename('Renamed Account B');
  assert.deepEqual(renamedB, {
    id: accountB,
    name: 'Renamed Account B',
  });

  const noSessionRepository = createPostgresAccountRepository(async () => null);
  await assert.rejects(
    noSessionRepository.rename('No Session'),
    (error) => error instanceof AppError && error.code === 'unauthorized'
  );

  const pooledIdentity = requireSuccess(
    await queryDb('SELECT auth.uid()::text AS user_id'),
    'pooled identity reset probe'
  );
  assert.deepEqual(pooledIdentity.rows, [{ user_id: null }]);

  console.log(
    'PostgreSQL account rename integration SUCCESS: verified account scope, admin-role enforcement, RLS cross-account isolation, updated_at trigger, missing-session denial, and transaction-local identity cleanup.'
  );
} finally {
  await pool.end();
}
