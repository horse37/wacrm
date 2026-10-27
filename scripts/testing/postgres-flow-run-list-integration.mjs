import assert from 'node:assert/strict';
import { AppError } from '../../src/lib/db/errors.ts';
import { queryDb } from '../../src/lib/db/postgres-client.ts';
import { getPostgresPool } from '../../src/lib/db/postgres-pool.ts';
import { createPostgresFlowRunListRepository } from '../../src/lib/repositories/flow-run-list.ts';

const ownerA = '00000000-0000-4000-8000-000000000001';
const viewerA = '00000000-0000-4000-8000-000000000003';
const agentA = '00000000-0000-4000-8000-000000000005';
const ownerB = '00000000-0000-4000-8000-000000000002';
const adminC = '00000000-0000-4000-8000-000000000004';
const flowA1 = '30000000-0000-4000-8000-000000000001';
const flowAInvalidCreator = '30000000-0000-4000-8000-000000000002';
const flowB1 = '30000000-0000-4000-8000-000000000004';
const contactA = '40000000-0000-4000-8000-000000000001';
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
  createPostgresFlowRunListRepository(async () => ({ userId }));

try {
  const runtime = requireSuccess(
    await queryDb(
      `SELECT current_user AS role, rolbypassrls
       FROM pg_roles WHERE rolname = current_user`
    ),
    'runtime role probe'
  );
  assert.deepEqual(runtime.rows, [
    { role: 'wacrm_flow_run_list_runtime', rolbypassrls: false },
  ]);

  const rls = requireSuccess(
    await queryDb(
      `SELECT c.relname, c.relrowsecurity, c.relforcerowsecurity
       FROM pg_class AS c
       INNER JOIN pg_namespace AS n ON n.oid = c.relnamespace
       WHERE n.nspname = 'public'
         AND c.relname = ANY($1::text[])
       ORDER BY c.relname`,
      [['accounts', 'contacts', 'flow_runs', 'flows', 'profiles']]
    ),
    'forced RLS probe'
  );
  assert.deepEqual(rls.rows, [
    { relname: 'accounts', relrowsecurity: true, relforcerowsecurity: true },
    { relname: 'contacts', relrowsecurity: true, relforcerowsecurity: true },
    { relname: 'flow_runs', relrowsecurity: true, relforcerowsecurity: true },
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
      table_name: 'contacts',
      column_name: 'account_id',
      privilege_type: 'SELECT',
    },
    { table_name: 'contacts', column_name: 'id', privilege_type: 'SELECT' },
    { table_name: 'contacts', column_name: 'name', privilege_type: 'SELECT' },
    { table_name: 'contacts', column_name: 'phone', privilege_type: 'SELECT' },
    {
      table_name: 'flow_runs',
      column_name: 'account_id',
      privilege_type: 'SELECT',
    },
    {
      table_name: 'flow_runs',
      column_name: 'contact_id',
      privilege_type: 'SELECT',
    },
    {
      table_name: 'flow_runs',
      column_name: 'current_node_key',
      privilege_type: 'SELECT',
    },
    {
      table_name: 'flow_runs',
      column_name: 'end_reason',
      privilege_type: 'SELECT',
    },
    {
      table_name: 'flow_runs',
      column_name: 'ended_at',
      privilege_type: 'SELECT',
    },
    {
      table_name: 'flow_runs',
      column_name: 'flow_id',
      privilege_type: 'SELECT',
    },
    { table_name: 'flow_runs', column_name: 'id', privilege_type: 'SELECT' },
    {
      table_name: 'flow_runs',
      column_name: 'last_advanced_at',
      privilege_type: 'SELECT',
    },
    {
      table_name: 'flow_runs',
      column_name: 'reprompt_count',
      privilege_type: 'SELECT',
    },
    {
      table_name: 'flow_runs',
      column_name: 'started_at',
      privilege_type: 'SELECT',
    },
    {
      table_name: 'flow_runs',
      column_name: 'status',
      privilege_type: 'SELECT',
    },
    {
      table_name: 'flow_runs',
      column_name: 'user_id',
      privilege_type: 'SELECT',
    },
    { table_name: 'flow_runs', column_name: 'vars', privilege_type: 'SELECT' },
    {
      table_name: 'flows',
      column_name: 'account_id',
      privilege_type: 'SELECT',
    },
    { table_name: 'flows', column_name: 'id', privilege_type: 'SELECT' },
    { table_name: 'flows', column_name: 'name', privilege_type: 'SELECT' },
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
         has_column_privilege(current_user, 'public.flows', 'description', 'SELECT') AS flow_description,
         has_column_privilege(current_user, 'public.flows', 'fallback_policy', 'SELECT') AS fallback_policy,
         has_column_privilege(current_user, 'public.flow_runs', 'conversation_id', 'SELECT') AS conversation_id,
         has_column_privilege(current_user, 'public.flow_runs', 'last_prompt_message_id', 'SELECT') AS prompt_message_id,
         has_column_privilege(current_user, 'public.contacts', 'email', 'SELECT') AS contact_email,
         has_column_privilege(current_user, 'public.profiles', 'full_name', 'SELECT') AS profile_name,
         has_table_privilege(current_user, 'public.flows', 'INSERT') AS flow_insert,
         has_table_privilege(current_user, 'public.flow_runs', 'INSERT') AS run_insert,
         has_table_privilege(current_user, 'public.contacts', 'UPDATE') AS contact_update`
    ),
    'least privilege probe'
  );
  assert.deepEqual(privilegeProbe.rows, [
    {
      flow_description: false,
      fallback_policy: false,
      conversation_id: false,
      prompt_message_id: false,
      contact_email: false,
      profile_name: false,
      flow_insert: false,
      run_insert: false,
      contact_update: false,
    },
  ]);

  const result = await repositoryFor(ownerA).listForFlow(flowA1);
  assert.equal(result.flow.id, flowA1);
  assert.equal(result.flow.name, 'Synthetic flow A1');
  assert.deepEqual(Object.keys(result.flow).sort(), ['id', 'name']);
  assert.equal(result.runs.length, 50);
  assert.equal(result.runs[0].id, '50000000-0000-4000-8000-000000000056');
  assert.equal(result.runs[0].contact, null);
  assert.equal(result.runs[1].id, '50000000-0000-4000-8000-000000000055');
  assert.deepEqual(result.runs[1].contact, {
    id: contactA,
    name: 'Synthetic Contact A',
    phone: '+15555550100',
  });
  assert.equal(result.runs.at(-1).id, '50000000-0000-4000-8000-000000000007');
  assert.deepEqual(
    new Set(result.runs.map((run) => run.status)),
    new Set([
      'active',
      'completed',
      'handed_off',
      'timed_out',
      'paused_by_agent',
      'failed',
    ])
  );
  assert.deepEqual(Object.keys(result.runs[0]).sort(), [
    'contact',
    'current_node_key',
    'end_reason',
    'ended_at',
    'id',
    'last_advanced_at',
    'reprompt_count',
    'started_at',
    'status',
    'vars',
  ]);
  const serialized = JSON.stringify(result);
  for (const omitted of [
    'account_id',
    'user_id',
    'conversation_id',
    'last_prompt_message_id',
    'private-a@example.invalid',
    'private-b@example.invalid',
    'Synthetic Contact B',
    '50000000-0000-4000-8000-000000000057',
    '50000000-0000-4000-8000-000000000058',
    '50000000-0000-4000-8000-000000000059',
  ]) {
    assert.equal(serialized.includes(omitted), false, omitted);
  }

  assert.deepEqual(await repositoryFor(viewerA).listForFlow(flowA1), result);
  assert.deepEqual(await repositoryFor(agentA).listForFlow(flowA1), result);
  await expectAppError(
    repositoryFor(ownerA).listForFlow(flowAInvalidCreator),
    'not_found'
  );
  await expectAppError(repositoryFor(ownerB).listForFlow(flowA1), 'not_found');
  await expectAppError(repositoryFor(adminC).listForFlow(flowA1), 'not_found');
  await expectAppError(repositoryFor(ownerA).listForFlow(flowB1), 'not_found');
  await expectAppError(
    repositoryFor(ownerA).listForFlow('bad-id'),
    'bad_request'
  );

  const noSessionRepository = createPostgresFlowRunListRepository(
    async () => null
  );
  await expectAppError(noSessionRepository.listForFlow(flowA1), 'unauthorized');

  const pooledIdentity = requireSuccess(
    await queryDb('SELECT auth.uid()::text AS user_id'),
    'pooled identity reset probe'
  );
  assert.deepEqual(pooledIdentity.rows, [{ user_id: null }]);

  const failClosed = requireSuccess(
    await queryDb(
      `SELECT
         (SELECT count(*)::int FROM public.flows) AS flows,
         (SELECT count(*)::int FROM public.flow_runs) AS flow_runs,
         (SELECT count(*)::int FROM public.contacts) AS contacts`
    ),
    'missing identity RLS probe'
  );
  assert.deepEqual(failClosed.rows, [{ flows: 0, flow_runs: 0, contacts: 0 }]);

  console.log(
    'PostgreSQL flow-run-list integration SUCCESS: forced RLS, NOBYPASSRLS, exact column grants, account/flow/creator isolation, optional same-account contact, 50-row stable order, minimal DTO, hidden not-found, and transaction-local identity cleanup.'
  );
} finally {
  await pool.end();
}
