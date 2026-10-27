import assert from 'node:assert/strict';
import { queryDb } from '../../src/lib/db/postgres-client.ts';
import { getPostgresPool } from '../../src/lib/db/postgres-pool.ts';
import { createPostgresAutomationDeletePersistenceRepository } from '../../src/lib/repositories/automation-delete-persistence.ts';

const agentA = '00000000-0000-4000-8000-000000000003';
const identityAutomationA = '30000000-0000-4000-8000-000000000007';
const pool = getPostgresPool();

function requireSuccess(result, label) {
  if (!result.ok) throw new Error(`${label} failed with ${result.error.code}`);
  return result.data;
}

try {
  assert.equal(process.env.PG_POOL_MAX, '1');

  const before = requireSuccess(
    await queryDb('SELECT pg_backend_pid()::int AS backend_pid'),
    'single pooled backend probe before delete'
  );
  const beforePid = before.rows[0].backend_pid;

  await createPostgresAutomationDeletePersistenceRepository(async () => ({
    userId: agentA,
  })).deleteOwnedAutomation(identityAutomationA);

  const after = requireSuccess(
    await queryDb(
      'SELECT pg_backend_pid()::int AS backend_pid, auth.uid()::text AS user_id'
    ),
    'same pooled backend identity cleanup probe'
  );
  assert.deepEqual(after.rows, [{ backend_pid: beforePid, user_id: null }]);

  const noIdentity = requireSuccess(
    await queryDb(
      'SELECT count(automation.id)::int AS count FROM public.automations AS automation'
    ),
    'single-connection missing identity RLS probe'
  );
  assert.deepEqual(noIdentity.rows, [{ count: 0 }]);

  console.log(
    `PostgreSQL automation-delete same-connection identity cleanup SUCCESS: pool size 1; backend ${beforePid} reused after committed deletion; transaction-local auth.uid() is null and RLS returns no rows.`
  );
} finally {
  await pool.end();
}
