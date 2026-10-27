import assert from 'node:assert/strict';
import { AppError } from '../../src/lib/db/errors.ts';
import { queryDb, withTransaction } from '../../src/lib/db/postgres-client.ts';
import { getPostgresPool } from '../../src/lib/db/postgres-pool.ts';
import { createDefaultPostgresAccountGuards } from '../../src/lib/auth/postgres-account-guard.ts';

const userA = '00000000-0000-4000-8000-000000000001';
const userB = '00000000-0000-4000-8000-000000000002';
const accountA = '10000000-0000-4000-8000-000000000001';
const accountB = '10000000-0000-4000-8000-000000000002';
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
    { role: 'wacrm_guard_runtime', rolbypassrls: false },
  ]);

  const guardA = createDefaultPostgresAccountGuards(async () => ({
    userId: userA,
  }));
  const guardB = createDefaultPostgresAccountGuards(async () => ({
    userId: userB,
  }));
  assert.deepEqual(await guardA.requireAccount(), {
    userId: userA,
    accountId: accountA,
    role: 'admin',
    account: { id: accountA, name: 'Synthetic Account A' },
  });
  assert.deepEqual(await guardB.requireAccount(), {
    userId: userB,
    accountId: accountB,
    role: 'agent',
    account: { id: accountB, name: 'Synthetic Account B' },
  });
  await assert.rejects(guardB.requireRole('admin'), AppError);

  const crossAccount = requireSuccess(
    await withTransaction(async (transaction) => {
      await transaction.query(
        "SELECT set_config('request.jwt.claim.sub', $1, true)",
        [userA]
      );
      const result = await transaction.query(
        'SELECT user_id FROM public.profiles WHERE user_id = $1',
        [userB]
      );
      return result.rows;
    }),
    'cross-account read probe'
  );
  assert.deepEqual(crossAccount, []);

  const missingProfile = createDefaultPostgresAccountGuards(async () => ({
    userId: '00000000-0000-4000-8000-000000000003',
  }));
  await assert.rejects(
    missingProfile.requireAccount(),
    (error) => error instanceof AppError && error.code === 'forbidden'
  );

  const pooledIdentity = requireSuccess(
    await queryDb('SELECT auth.uid()::text AS user_id'),
    'pooled identity reset probe'
  );
  assert.deepEqual(pooledIdentity.rows, [{ user_id: null }]);

  console.log(
    'PostgreSQL account guard integration SUCCESS: least-privilege role, RLS account lookup, role denial, cross-account denial, missing membership, and transaction-local identity cleanup.'
  );
} finally {
  await pool.end();
}
