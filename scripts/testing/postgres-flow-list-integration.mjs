import assert from 'node:assert/strict';
import { AppError } from '../../src/lib/db/errors.ts';
import { queryDb } from '../../src/lib/db/postgres-client.ts';
import { getPostgresPool } from '../../src/lib/db/postgres-pool.ts';
import { createPostgresFlowListRepository } from '../../src/lib/repositories/flow-list.ts';

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

const repositoryFor = (userId) =>
  createPostgresFlowListRepository(async () => ({ userId }));

try {
  const runtime = requireSuccess(
    await queryDb(
      `SELECT current_user AS role, rolbypassrls
       FROM pg_roles WHERE rolname = current_user`
    ),
    'runtime role probe'
  );
  assert.deepEqual(runtime.rows, [
    { role: 'wacrm_flow_list_runtime', rolbypassrls: false },
  ]);

  const rls = requireSuccess(
    await queryDb(
      `SELECT c.relname, c.relrowsecurity, c.relforcerowsecurity
       FROM pg_class AS c
       INNER JOIN pg_namespace AS n ON n.oid = c.relnamespace
       WHERE n.nspname = 'public'
         AND c.relname = ANY($1::text[])
       ORDER BY c.relname`,
      [['accounts', 'profiles', 'flows']]
    ),
    'forced RLS probe'
  );
  assert.deepEqual(rls.rows, [
    { relname: 'accounts', relrowsecurity: true, relforcerowsecurity: true },
    { relname: 'flows', relrowsecurity: true, relforcerowsecurity: true },
    { relname: 'profiles', relrowsecurity: true, relforcerowsecurity: true },
  ]);

  const columnGrants = requireSuccess(
    await queryDb(
      `SELECT table_name, column_name, privilege_type
       FROM information_schema.column_privileges
       WHERE grantee = current_user AND table_schema = 'public'
       ORDER BY table_name, column_name, privilege_type`
    ),
    'column grant probe'
  );
  assert.deepEqual(columnGrants.rows, [
    { table_name: 'accounts', column_name: 'id', privilege_type: 'SELECT' },
    { table_name: 'accounts', column_name: 'name', privilege_type: 'SELECT' },
    {
      table_name: 'flows',
      column_name: 'account_id',
      privilege_type: 'SELECT',
    },
    {
      table_name: 'flows',
      column_name: 'created_at',
      privilege_type: 'SELECT',
    },
    {
      table_name: 'flows',
      column_name: 'description',
      privilege_type: 'SELECT',
    },
    {
      table_name: 'flows',
      column_name: 'execution_count',
      privilege_type: 'SELECT',
    },
    { table_name: 'flows', column_name: 'id', privilege_type: 'SELECT' },
    { table_name: 'flows', column_name: 'name', privilege_type: 'SELECT' },
    { table_name: 'flows', column_name: 'status', privilege_type: 'SELECT' },
    {
      table_name: 'flows',
      column_name: 'trigger_config',
      privilege_type: 'SELECT',
    },
    {
      table_name: 'flows',
      column_name: 'trigger_type',
      privilege_type: 'SELECT',
    },
    { table_name: 'flows', column_name: 'user_id', privilege_type: 'SELECT' },
    {
      table_name: 'profiles',
      column_name: 'account_id',
      privilege_type: 'SELECT',
    },
    {
      table_name: 'profiles',
      column_name: 'account_role',
      privilege_type: 'SELECT',
    },
    {
      table_name: 'profiles',
      column_name: 'user_id',
      privilege_type: 'SELECT',
    },
  ]);

  const privilegeProbe = requireSuccess(
    await queryDb(
      `SELECT
         has_column_privilege(current_user, 'public.flows', 'entry_node_id', 'SELECT') AS entry_node_id,
         has_column_privilege(current_user, 'public.flows', 'fallback_policy', 'SELECT') AS fallback_policy,
         has_column_privilege(current_user, 'public.flows', 'last_executed_at', 'SELECT') AS last_executed_at,
         has_column_privilege(current_user, 'public.flows', 'updated_at', 'SELECT') AS updated_at,
         has_column_privilege(current_user, 'public.profiles', 'full_name', 'SELECT') AS profile_name,
         has_table_privilege(current_user, 'public.flows', 'INSERT') AS flow_insert,
         has_table_privilege(current_user, 'public.flows', 'UPDATE') AS flow_update,
         has_table_privilege(current_user, 'public.flows', 'DELETE') AS flow_delete`
    ),
    'least privilege probe'
  );
  assert.deepEqual(privilegeProbe.rows, [
    {
      entry_node_id: false,
      fallback_policy: false,
      last_executed_at: false,
      updated_at: false,
      profile_name: false,
      flow_insert: false,
      flow_update: false,
      flow_delete: false,
    },
  ]);

  const listA = await repositoryFor(ownerA).listForCurrentAccount();
  assert.deepEqual(listA, [
    {
      id: '30000000-0000-4000-8000-000000000004',
      name: 'Former member flow',
      description: null,
      status: 'active',
      trigger_type: 'keyword',
      trigger_config: {},
      execution_count: 99,
    },
    {
      id: '30000000-0000-4000-8000-000000000003',
      name: 'Newest A',
      description: null,
      status: 'active',
      trigger_type: 'keyword',
      trigger_config: { keywords: ['synthetic', 'test'] },
      execution_count: 12,
    },
    {
      id: '30000000-0000-4000-8000-000000000001',
      name: 'Newest A tie',
      description: 'Stable UUID order',
      status: 'draft',
      trigger_type: 'manual',
      trigger_config: {},
      execution_count: 0,
    },
    {
      id: '30000000-0000-4000-8000-000000000002',
      name: 'Older A',
      description: 'Synthetic description',
      status: 'archived',
      trigger_type: 'first_inbound_message',
      trigger_config: { keywords: [] },
      execution_count: 5,
    },
  ]);
  assert.deepEqual(Object.keys(listA[0]).sort(), [
    'description',
    'execution_count',
    'id',
    'name',
    'status',
    'trigger_config',
    'trigger_type',
  ]);
  assert.equal(JSON.stringify(listA).includes('private-node-key'), false);
  assert.equal(JSON.stringify(listA).includes('synthetic fallback'), false);
  assert.deepEqual(await repositoryFor(viewerA).listForCurrentAccount(), listA);
  assert.deepEqual(await repositoryFor(agentA).listForCurrentAccount(), listA);
  assert.deepEqual(
    (await repositoryFor(ownerB).listForCurrentAccount()).map(
      (flow) => flow.id
    ),
    ['30000000-0000-4000-8000-000000000005']
  );
  assert.deepEqual(await repositoryFor(adminC).listForCurrentAccount(), []);
  assert.equal(
    listA.some((flow) => flow.id === '30000000-0000-4000-8000-000000000004'),
    true,
    'account-owned flow remains visible after creator profile moves to a personal account'
  );

  const noSessionRepository = createPostgresFlowListRepository(
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
    await queryDb('SELECT count(*)::int AS count FROM public.flows'),
    'missing identity RLS probe'
  );
  assert.deepEqual(failClosed.rows, [{ count: 0 }]);

  console.log(
    'PostgreSQL flow-list integration SUCCESS: forced RLS, NOBYPASSRLS, exact column grants, account-scoped visibility after creator profile moves, cross-account isolation, owner/agent/viewer access, stable newest-first ordering, nullable fields, allowlisted DTO, empty account, and transaction-local identity cleanup.'
  );
} finally {
  await pool.end();
}
