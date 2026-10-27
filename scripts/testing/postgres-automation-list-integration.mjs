import assert from 'node:assert/strict';
import { AppError } from '../../src/lib/db/errors.ts';
import { queryDb } from '../../src/lib/db/postgres-client.ts';
import { getPostgresPool } from '../../src/lib/db/postgres-pool.ts';
import { createPostgresAutomationListRepository } from '../../src/lib/repositories/automation-list.ts';

const ownerA = '00000000-0000-4000-8000-000000000001';
const viewerA = '00000000-0000-4000-8000-000000000003';
const agentA = '00000000-0000-4000-8000-000000000005';
const ownerB = '00000000-0000-4000-8000-000000000002';
const adminC = '00000000-0000-4000-8000-000000000004';
const pool = getPostgresPool();

function requireSuccess(result, label) {
  if (!result.ok) throw new Error(`${label} failed with ${result.error.code}`);
  return result.data;
}

try {
  const runtime = requireSuccess(
    await queryDb(
      `SELECT current_user AS role, rolbypassrls
       FROM pg_roles WHERE rolname = current_user`
    ),
    'runtime role probe'
  );
  assert.deepEqual(runtime.rows, [
    { role: 'wacrm_automation_list_runtime', rolbypassrls: false },
  ]);

  const grants = requireSuccess(
    await queryDb(
      `SELECT table_name, privilege_type
       FROM information_schema.role_table_grants
       WHERE grantee = current_user AND table_schema = 'public'
       ORDER BY table_name, privilege_type`
    ),
    'runtime table grant probe'
  );
  assert.deepEqual(grants.rows, [
    { table_name: 'accounts', privilege_type: 'SELECT' },
    { table_name: 'automations', privilege_type: 'SELECT' },
    { table_name: 'profiles', privilege_type: 'SELECT' },
  ]);

  const repositoryFor = (userId) =>
    createPostgresAutomationListRepository(async () => ({ userId }));
  const listA = await repositoryFor(ownerA).listForCurrentAccount();
  assert.deepEqual(listA, [
    {
      id: '30000000-0000-4000-8000-000000000003',
      name: 'Newest A tie',
      description: 'Stable UUID ordering',
      trigger_type: 'tag_added',
      is_active: false,
      execution_count: 0,
      last_executed_at: '2026-10-19T10:00:00.000Z',
    },
    {
      id: '30000000-0000-4000-8000-000000000001',
      name: 'Newest A',
      description: null,
      trigger_type: 'new_message_received',
      is_active: true,
      execution_count: 3,
      last_executed_at: null,
    },
    {
      id: '30000000-0000-4000-8000-000000000002',
      name: 'Older A',
      description: 'Visible to this account',
      trigger_type: 'keyword_match',
      is_active: false,
      execution_count: 7,
      last_executed_at: '2026-10-18T07:00:00.000Z',
    },
  ]);
  assert.deepEqual(Object.keys(listA[0]).sort(), [
    'description',
    'execution_count',
    'id',
    'is_active',
    'last_executed_at',
    'name',
    'trigger_type',
  ]);
  assert.equal(
    JSON.stringify(listA).includes('SYNTHETIC_TRIGGER_CONFIG_MUST_NOT_LEAK'),
    false
  );
  assert.deepEqual(await repositoryFor(viewerA).listForCurrentAccount(), listA);
  assert.deepEqual(await repositoryFor(agentA).listForCurrentAccount(), listA);
  assert.deepEqual(
    (await repositoryFor(ownerB).listForCurrentAccount()).map(
      (item) => item.id
    ),
    ['30000000-0000-4000-8000-000000000005']
  );
  assert.deepEqual(await repositoryFor(adminC).listForCurrentAccount(), []);

  const noSessionRepository = createPostgresAutomationListRepository(
    async () => null
  );
  await assert.rejects(
    noSessionRepository.listForCurrentAccount(),
    (error) => error instanceof AppError && error.code === 'unauthorized'
  );

  const pooledIdentity = requireSuccess(
    await queryDb('SELECT auth.uid()::text AS user_id'),
    'pooled identity reset probe'
  );
  assert.deepEqual(pooledIdentity.rows, [{ user_id: null }]);

  const failClosed = requireSuccess(
    await queryDb('SELECT count(*)::int AS count FROM public.automations'),
    'missing identity RLS probe'
  );
  assert.deepEqual(failClosed.rows, [{ count: 0 }]);

  console.log(
    'PostgreSQL automation-list integration SUCCESS: forced RLS, NOBYPASSRLS, SELECT-only minimal grants, account and creator isolation, owner/agent/viewer access, stable ordering, nullable fields, safe projection, empty account, and transaction-local identity cleanup.'
  );
} finally {
  await pool.end();
}
