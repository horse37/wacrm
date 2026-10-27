import assert from 'node:assert/strict';
import { queryDb } from '../../src/lib/db/postgres-client.ts';
import { getPostgresPool } from '../../src/lib/db/postgres-pool.ts';
import { createPostgresAutomationUpdatePersistenceRepository } from '../../src/lib/repositories/automation-update-persistence.ts';

const agentA = '00000000-0000-4000-8000-000000000003';
const identityId = '30000000-0000-4000-8000-000000000006';
const pool = getPostgresPool();

function requireSuccess(result, label) {
  if (!result.ok) throw new Error(`${label} failed with ${result.error.code}`);
  return result.data;
}

try {
  assert.equal(process.env.PG_POOL_MAX, '1');
  const before = requireSuccess(
    await queryDb('SELECT pg_backend_pid()::int AS backend_pid'),
    'single pooled backend before update'
  );
  const beforePid = before.rows[0].backend_pid;

  await createPostgresAutomationUpdatePersistenceRepository(async () => ({
    userId: agentA,
  })).patchOwnedAutomation(identityId, { name: 'Synthetic identity patched' });

  const after = requireSuccess(
    await queryDb(
      'SELECT pg_backend_pid()::int AS backend_pid, auth.uid()::text AS user_id'
    ),
    'same pooled backend identity cleanup after update'
  );
  assert.deepEqual(after.rows, [{ backend_pid: beforePid, user_id: null }]);

  const hidden = requireSuccess(
    await queryDb(
      `SELECT count(automation.id)::int AS count
       FROM public.automations AS automation
       WHERE automation.id = $1`,
      [identityId]
    ),
    'same-connection missing identity RLS probe'
  );
  assert.deepEqual(hidden.rows, [{ count: 0 }]);

  console.log(
    `PostgreSQL automation-update identity cleanup SUCCESS: pool size 1; backend ${beforePid} reused after committed update; transaction-local auth.uid() is null and RLS hides the updated automation.`
  );
} finally {
  await pool.end();
}
