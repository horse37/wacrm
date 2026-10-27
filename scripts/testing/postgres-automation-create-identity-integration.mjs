import assert from 'node:assert/strict';
import { queryDb } from '../../src/lib/db/postgres-client.ts';
import { getPostgresPool } from '../../src/lib/db/postgres-pool.ts';
import { createPostgresAutomationCreatePersistenceRepository } from '../../src/lib/repositories/automation-create-persistence.ts';

const agentA = '00000000-0000-4000-8000-000000000003';
const pool = getPostgresPool();

function requireSuccess(result, label) {
  if (!result.ok) throw new Error(`${label} failed with ${result.error.code}`);
  return result.data;
}

try {
  assert.equal(process.env.PG_POOL_MAX, '1');
  const before = requireSuccess(
    await queryDb('SELECT pg_backend_pid()::int AS backend_pid'),
    'single pooled backend before creation'
  );
  const beforePid = before.rows[0].backend_pid;

  const created = await createPostgresAutomationCreatePersistenceRepository(
    async () => ({ userId: agentA })
  ).createAutomation({
    name: 'Synthetic identity creation',
    trigger_type: 'new_message_received',
    is_active: false,
    steps: [
      { step_type: 'send_message', step_config: { text: 'Synthetic only' } },
    ],
  });

  const after = requireSuccess(
    await queryDb(
      'SELECT pg_backend_pid()::int AS backend_pid, auth.uid()::text AS user_id'
    ),
    'same pooled backend identity cleanup after creation'
  );
  assert.deepEqual(after.rows, [{ backend_pid: beforePid, user_id: null }]);

  const noIdentity = requireSuccess(
    await queryDb(
      `SELECT count(automation.id)::int AS count
       FROM public.automations AS automation
       WHERE automation.id = $1`,
      [created.id]
    ),
    'same-connection missing identity RLS probe'
  );
  assert.deepEqual(noIdentity.rows, [{ count: 0 }]);

  console.log(
    `PostgreSQL automation-create identity cleanup SUCCESS: pool size 1; backend ${beforePid} reused after committed parent/step creation; transaction-local auth.uid() is null and RLS hides the created automation.`
  );
} finally {
  await pool.end();
}
