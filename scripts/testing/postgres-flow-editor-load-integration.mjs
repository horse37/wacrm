import assert from 'node:assert/strict';
import { AppError } from '../../src/lib/db/errors.ts';
import { queryDb } from '../../src/lib/db/postgres-client.ts';
import { getPostgresPool } from '../../src/lib/db/postgres-pool.ts';
import { createPostgresFlowEditorLoadRepository } from '../../src/lib/repositories/flow-editor-load.ts';

const ownerA = '00000000-0000-4000-8000-000000000001';
const viewerA = '00000000-0000-4000-8000-000000000003';
const agentA = '00000000-0000-4000-8000-000000000005';
const ownerB = '00000000-0000-4000-8000-000000000002';
const adminC = '00000000-0000-4000-8000-000000000004';
const flowA1 = '30000000-0000-4000-8000-000000000001';
const flowAInvalidCreator = '30000000-0000-4000-8000-000000000003';
const flowB1 = '30000000-0000-4000-8000-000000000004';
const pool = getPostgresPool();

function requireSuccess(result, label) {
  if (!result.ok) throw new Error(`${label} failed with ${result.error.code}`);
  return result.data;
}

async function expectAppError(promise, code) {
  await assert.rejects(
    promise,
    (error) => error instanceof AppError && error.code === code
  );
}

const repositoryFor = (userId) =>
  createPostgresFlowEditorLoadRepository(async () => ({ userId }));

try {
  const runtime = requireSuccess(
    await queryDb(
      `SELECT current_user AS role, rolbypassrls
       FROM pg_roles WHERE rolname = current_user`
    ),
    'runtime role probe'
  );
  assert.deepEqual(runtime.rows, [
    { role: 'wacrm_flow_editor_load_runtime', rolbypassrls: false },
  ]);

  const rls = requireSuccess(
    await queryDb(
      `SELECT c.relname, c.relrowsecurity, c.relforcerowsecurity
       FROM pg_class AS c
       INNER JOIN pg_namespace AS n ON n.oid = c.relnamespace
       WHERE n.nspname = 'public'
         AND c.relname = ANY($1::text[])
       ORDER BY c.relname`,
      [['accounts', 'flow_nodes', 'flows', 'profiles']]
    ),
    'forced RLS probe'
  );
  assert.deepEqual(rls.rows, [
    { relname: 'accounts', relrowsecurity: true, relforcerowsecurity: true },
    { relname: 'flow_nodes', relrowsecurity: true, relforcerowsecurity: true },
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
      table_name: 'flow_nodes',
      column_name: 'config',
      privilege_type: 'SELECT',
    },
    {
      table_name: 'flow_nodes',
      column_name: 'created_at',
      privilege_type: 'SELECT',
    },
    {
      table_name: 'flow_nodes',
      column_name: 'flow_id',
      privilege_type: 'SELECT',
    },
    { table_name: 'flow_nodes', column_name: 'id', privilege_type: 'SELECT' },
    {
      table_name: 'flow_nodes',
      column_name: 'node_key',
      privilege_type: 'SELECT',
    },
    {
      table_name: 'flow_nodes',
      column_name: 'node_type',
      privilege_type: 'SELECT',
    },
    {
      table_name: 'flow_nodes',
      column_name: 'position_x',
      privilege_type: 'SELECT',
    },
    {
      table_name: 'flow_nodes',
      column_name: 'position_y',
      privilege_type: 'SELECT',
    },
    {
      table_name: 'flows',
      column_name: 'account_id',
      privilege_type: 'SELECT',
    },
    {
      table_name: 'flows',
      column_name: 'description',
      privilege_type: 'SELECT',
    },
    {
      table_name: 'flows',
      column_name: 'entry_node_id',
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
         has_column_privilege(current_user, 'public.flows', 'fallback_policy', 'SELECT') AS fallback_policy,
         has_column_privilege(current_user, 'public.flows', 'execution_count', 'SELECT') AS execution_count,
         has_column_privilege(current_user, 'public.flows', 'last_executed_at', 'SELECT') AS last_executed_at,
         has_column_privilege(current_user, 'public.flows', 'updated_at', 'SELECT') AS flow_updated_at,
         has_column_privilege(current_user, 'public.flows', 'created_at', 'SELECT') AS flow_created_at,
         has_column_privilege(current_user, 'public.profiles', 'full_name', 'SELECT') AS profile_name,
         has_table_privilege(current_user, 'public.flows', 'INSERT') AS flow_insert,
         has_table_privilege(current_user, 'public.flows', 'UPDATE') AS flow_update,
         has_table_privilege(current_user, 'public.flows', 'DELETE') AS flow_delete,
         has_table_privilege(current_user, 'public.flow_nodes', 'INSERT') AS node_insert,
         has_table_privilege(current_user, 'public.flow_nodes', 'UPDATE') AS node_update,
         has_table_privilege(current_user, 'public.flow_nodes', 'DELETE') AS node_delete`
    ),
    'least privilege probe'
  );
  assert.deepEqual(privilegeProbe.rows, [
    {
      fallback_policy: false,
      execution_count: false,
      last_executed_at: false,
      flow_updated_at: false,
      flow_created_at: false,
      profile_name: false,
      flow_insert: false,
      flow_update: false,
      flow_delete: false,
      node_insert: false,
      node_update: false,
      node_delete: false,
    },
  ]);

  const flow = await repositoryFor(ownerA).getForFlow(flowA1);
  assert.deepEqual(flow, {
    flow: {
      id: flowA1,
      name: 'Synthetic flow A1',
      description: null,
      status: 'draft',
      trigger_type: 'keyword',
      trigger_config: { keywords: ['synthetic'] },
      entry_node_id: 'start',
    },
    nodes: [
      {
        node_key: 'start',
        node_type: 'start',
        config: { next_node_key: 'message' },
        position_x: 0,
        position_y: 0,
      },
      {
        node_key: 'message',
        node_type: 'send_message',
        config: { text: 'Synthetic only', next_node_key: 'end' },
        position_x: -10,
        position_y: 20,
      },
      {
        node_key: 'end',
        node_type: 'end',
        config: {},
        position_x: 30,
        position_y: 20,
      },
    ],
  });
  assert.deepEqual(Object.keys(flow.flow).sort(), [
    'description',
    'entry_node_id',
    'id',
    'name',
    'status',
    'trigger_config',
    'trigger_type',
  ]);
  assert.deepEqual(Object.keys(flow.nodes[0]).sort(), [
    'config',
    'node_key',
    'node_type',
    'position_x',
    'position_y',
  ]);
  const serializedFlow = JSON.stringify(flow);
  for (const omitted of [
    'fallback marker',
    'account_id',
    'user_id',
    'created_at',
    'updated_at',
    'flow_id',
    '40000000-0000-4000-8000-000000000001',
  ]) {
    assert.equal(serializedFlow.includes(omitted), false, omitted);
  }
  assert.deepEqual(await repositoryFor(viewerA).getForFlow(flowA1), flow);
  assert.deepEqual(await repositoryFor(agentA).getForFlow(flowA1), flow);
  assert.deepEqual(await repositoryFor(ownerB).getForFlow(flowB1), {
    flow: {
      id: flowB1,
      name: 'Synthetic flow B1',
      description: 'Account B',
      status: 'draft',
      trigger_type: 'first_inbound_message',
      trigger_config: {},
      entry_node_id: null,
    },
    nodes: [
      {
        node_key: 'account-b-start',
        node_type: 'start',
        config: { next_node_key: 'account-b-end' },
        position_x: 0,
        position_y: 0,
      },
    ],
  });

  await expectAppError(
    repositoryFor(ownerA).getForFlow(flowAInvalidCreator),
    'not_found'
  );
  await expectAppError(repositoryFor(adminC).getForFlow(flowA1), 'not_found');
  await expectAppError(
    repositoryFor(ownerA).getForFlow('bad-id'),
    'bad_request'
  );
  await expectAppError(
    repositoryFor(ownerA).getForFlow('30000000-0000-4000-8000-000000000099'),
    'not_found'
  );

  const noSessionRepository = createPostgresFlowEditorLoadRepository(
    async () => null
  );
  await expectAppError(noSessionRepository.getForFlow(flowA1), 'unauthorized');

  const pooledIdentity = requireSuccess(
    await queryDb('SELECT auth.uid()::text AS user_id'),
    'pooled identity reset probe'
  );
  assert.deepEqual(pooledIdentity.rows, [{ user_id: null }]);

  const failClosed = requireSuccess(
    await queryDb(
      `SELECT
         (SELECT count(*)::int FROM public.flows) AS flows,
         (SELECT count(*)::int FROM public.flow_nodes) AS flow_nodes`
    ),
    'missing identity RLS probe'
  );
  assert.deepEqual(failClosed.rows, [{ flows: 0, flow_nodes: 0 }]);

  console.log(
    'PostgreSQL flow-editor-load integration SUCCESS: forced RLS, NOBYPASSRLS, exact column grants, account/member isolation, creator consistency, stable node order, allowlisted DTO, hidden not-found, and transaction-local identity cleanup.'
  );
} finally {
  await pool.end();
}
