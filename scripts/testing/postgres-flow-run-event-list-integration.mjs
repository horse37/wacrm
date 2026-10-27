import assert from 'node:assert/strict';
import { AppError } from '../../src/lib/db/errors.ts';
import { queryDb } from '../../src/lib/db/postgres-client.ts';
import { getPostgresPool } from '../../src/lib/db/postgres-pool.ts';
import { createPostgresFlowRunEventListRepository } from '../../src/lib/repositories/flow-run-event-list.ts';

const ownerA = '00000000-0000-4000-8000-000000000001';
const viewerA = '00000000-0000-4000-8000-000000000003';
const agentA = '00000000-0000-4000-8000-000000000005';
const ownerB = '00000000-0000-4000-8000-000000000002';
const adminC = '00000000-0000-4000-8000-000000000004';
const flowA1 = '30000000-0000-4000-8000-000000000001';
const flowAInvalidCreator = '30000000-0000-4000-8000-000000000002';
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
  createPostgresFlowRunEventListRepository(async () => ({ userId }));

try {
  const runtime = requireSuccess(
    await queryDb(
      `SELECT current_user AS role, rolbypassrls
       FROM pg_roles WHERE rolname = current_user`
    ),
    'runtime role probe'
  );
  assert.deepEqual(runtime.rows, [
    { role: 'wacrm_flow_run_event_list_runtime', rolbypassrls: false },
  ]);

  const rls = requireSuccess(
    await queryDb(
      `SELECT c.relname, c.relrowsecurity, c.relforcerowsecurity
       FROM pg_class AS c
       INNER JOIN pg_namespace AS n ON n.oid = c.relnamespace
       WHERE n.nspname = 'public'
         AND c.relname = ANY($1::text[])
       ORDER BY c.relname`,
      [['accounts', 'flow_run_events', 'flow_runs', 'flows', 'profiles']]
    ),
    'forced RLS probe'
  );
  assert.deepEqual(rls.rows, [
    { relname: 'accounts', relrowsecurity: true, relforcerowsecurity: true },
    {
      relname: 'flow_run_events',
      relrowsecurity: true,
      relforcerowsecurity: true,
    },
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
      table_name: 'flow_run_events',
      column_name: 'created_at',
      privilege_type: 'SELECT',
    },
    {
      table_name: 'flow_run_events',
      column_name: 'event_type',
      privilege_type: 'SELECT',
    },
    {
      table_name: 'flow_run_events',
      column_name: 'flow_run_id',
      privilege_type: 'SELECT',
    },
    {
      table_name: 'flow_run_events',
      column_name: 'id',
      privilege_type: 'SELECT',
    },
    {
      table_name: 'flow_run_events',
      column_name: 'node_key',
      privilege_type: 'SELECT',
    },
    {
      table_name: 'flow_run_events',
      column_name: 'payload',
      privilege_type: 'SELECT',
    },
    {
      table_name: 'flow_runs',
      column_name: 'account_id',
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
      column_name: 'started_at',
      privilege_type: 'SELECT',
    },
    {
      table_name: 'flow_runs',
      column_name: 'user_id',
      privilege_type: 'SELECT',
    },
    {
      table_name: 'flows',
      column_name: 'account_id',
      privilege_type: 'SELECT',
    },
    { table_name: 'flows', column_name: 'id', privilege_type: 'SELECT' },
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
         has_column_privilege(current_user, 'public.flows', 'name', 'SELECT') AS flow_name,
         has_column_privilege(current_user, 'public.flows', 'fallback_policy', 'SELECT') AS fallback_policy,
         has_column_privilege(current_user, 'public.flow_runs', 'status', 'SELECT') AS run_status,
         has_column_privilege(current_user, 'public.flow_run_events', 'payload', 'SELECT') AS event_payload,
         has_table_privilege(current_user, 'public.flows', 'INSERT') AS flow_insert,
         has_table_privilege(current_user, 'public.flow_runs', 'UPDATE') AS run_update,
         has_table_privilege(current_user, 'public.flow_run_events', 'DELETE') AS event_delete`
    ),
    'least privilege probe'
  );
  assert.deepEqual(privilegeProbe.rows, [
    {
      flow_name: false,
      fallback_policy: false,
      run_status: false,
      event_payload: true,
      flow_insert: false,
      run_update: false,
      event_delete: false,
    },
  ]);

  const events = await repositoryFor(ownerA).listForFlow(flowA1);
  assert.deepEqual(events, [
    {
      flow_run_id: '50000000-0000-4000-8000-000000000054',
      event_type: 'node_entered',
      node_key: 'start',
      payload: { node_type: 'start' },
      created_at: '2026-10-19T12:00:00.000Z',
    },
    {
      flow_run_id: '50000000-0000-4000-8000-000000000055',
      event_type: 'started',
      node_key: 'start',
      payload: { source: 'synthetic' },
      created_at: '2026-10-20T12:00:00.000Z',
    },
    {
      flow_run_id: '50000000-0000-4000-8000-000000000055',
      event_type: 'reply_received',
      node_key: null,
      payload: { reply_id: 'synthetic-yes' },
      created_at: '2026-10-20T12:00:00.000Z',
    },
    {
      flow_run_id: '50000000-0000-4000-8000-000000000006',
      event_type: 'completed',
      node_key: 'end',
      payload: {},
      created_at: '2026-10-22T12:00:00.000Z',
    },
  ]);
  assert.deepEqual(Object.keys(events[0]).sort(), [
    'created_at',
    'event_type',
    'flow_run_id',
    'node_key',
    'payload',
  ]);
  const serialized = JSON.stringify(events);
  for (const omitted of [
    'event_id',
    'account_id',
    'user_id',
    'flow_id',
    'excluded-old-run',
    'excluded-author',
    'excluded-account',
    'excluded-flow',
  ]) {
    assert.equal(serialized.includes(omitted), false, omitted);
  }

  assert.deepEqual(await repositoryFor(viewerA).listForFlow(flowA1), events);
  assert.deepEqual(await repositoryFor(agentA).listForFlow(flowA1), events);
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

  const noSessionRepository = createPostgresFlowRunEventListRepository(
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
         (SELECT count(*)::int FROM public.flow_run_events) AS flow_run_events`
    ),
    'missing identity RLS probe'
  );
  assert.deepEqual(failClosed.rows, [
    { flows: 0, flow_runs: 0, flow_run_events: 0 },
  ]);

  console.log(
    'PostgreSQL flow-run-event-list integration SUCCESS: forced RLS, NOBYPASSRLS, exact column grants, account/flow/creator isolation, recent 50-run scope, complete selected-run timelines, stable event order, minimal DTO, hidden not-found, and transaction-local identity cleanup.'
  );
} finally {
  await pool.end();
}
