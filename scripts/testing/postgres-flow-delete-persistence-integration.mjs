import assert from 'node:assert/strict';
import { AppError } from '../../src/lib/db/errors.ts';
import { queryDb } from '../../src/lib/db/postgres-client.ts';
import { getPostgresPool } from '../../src/lib/db/postgres-pool.ts';
import { createPostgresFlowDeletePersistenceRepository } from '../../src/lib/repositories/flow-delete-persistence.ts';

const agentA = '00000000-0000-4000-8000-000000000003';
const viewerA = '00000000-0000-4000-8000-000000000004';
const ownedFlowA = '70000000-0000-4000-8000-000000000001';
const otherOwnerFlowA = '70000000-0000-4000-8000-000000000002';
const otherAccountFlowB = '70000000-0000-4000-8000-000000000003';
const racingFlowA = '70000000-0000-4000-8000-000000000004';
const viewerFlowA = '70000000-0000-4000-8000-000000000005';
const pool = getPostgresPool();

function requireSuccess(result, label) {
  if (!result.ok) throw new Error(`${label} failed with ${result.error.code}`);
  return result.data;
}

function repositoryFor(userId) {
  return createPostgresFlowDeletePersistenceRepository(async () => ({
    userId,
  }));
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
    { role: 'wacrm_flow_delete_runtime', rolbypassrls: false },
  ]);

  const rls = requireSuccess(
    await queryDb(
      `SELECT c.relname, c.relrowsecurity, c.relforcerowsecurity
       FROM pg_class AS c
       INNER JOIN pg_namespace AS n ON n.oid = c.relnamespace
       WHERE n.nspname = 'public'
         AND c.relname = ANY($1::text[])
       ORDER BY c.relname`,
      [
        [
          'accounts',
          'flow_nodes',
          'flow_run_events',
          'flow_runs',
          'flows',
          'profiles',
        ],
      ]
    ),
    'forced RLS probe'
  );
  assert.deepEqual(
    rls.rows,
    [
      'accounts',
      'flow_nodes',
      'flow_run_events',
      'flow_runs',
      'flows',
      'profiles',
    ].map((relname) => ({
      relname,
      relrowsecurity: true,
      relforcerowsecurity: true,
    }))
  );

  const columnGrants = requireSuccess(
    await queryDb(
      `SELECT table_name, column_name, privilege_type
       FROM information_schema.role_column_grants
       WHERE grantee = current_user AND table_schema = 'public'
       ORDER BY privilege_type, table_name, column_name`
    ),
    'runtime column grant probe'
  );
  const expectedColumnGrants = [
    ...['accounts.id', 'accounts.name'].map((column) => `SELECT:${column}`),
    ...[
      'flows.account_id',
      'flows.id',
      'flows.user_id',
      'profiles.account_id',
      'profiles.account_role',
      'profiles.user_id',
    ].map((column) => `SELECT:${column}`),
  ].sort();
  assert.deepEqual(
    columnGrants.rows
      .map(
        (row) => `${row.privilege_type}:${row.table_name}.${row.column_name}`
      )
      .sort(),
    expectedColumnGrants
  );

  const tableGrants = requireSuccess(
    await queryDb(
      `SELECT table_name, privilege_type
       FROM information_schema.role_table_grants
       WHERE grantee = current_user AND table_schema = 'public'
       ORDER BY table_name, privilege_type`
    ),
    'runtime table grant probe'
  );
  assert.deepEqual(tableGrants.rows, [
    { table_name: 'flows', privilege_type: 'DELETE' },
  ]);

  await assert.rejects(
    createPostgresFlowDeletePersistenceRepository(
      async () => null
    ).deleteOwnedFlow(ownedFlowA),
    (error) => error instanceof AppError && error.code === 'unauthorized'
  );
  await assert.rejects(
    repositoryFor(viewerA).deleteOwnedFlow(viewerFlowA),
    (error) => error instanceof AppError && error.code === 'forbidden'
  );
  await assert.rejects(
    repositoryFor(agentA).deleteOwnedFlow('not-a-flow-id'),
    (error) => error instanceof AppError && error.code === 'bad_request'
  );
  await assert.rejects(
    repositoryFor(agentA).deleteOwnedFlow(otherOwnerFlowA),
    (error) => error instanceof AppError && error.code === 'not_found'
  );
  await assert.rejects(
    repositoryFor(agentA).deleteOwnedFlow(otherAccountFlowB),
    (error) => error instanceof AppError && error.code === 'not_found'
  );

  await repositoryFor(agentA).deleteOwnedFlow(ownedFlowA);
  const racingDeletes = await Promise.allSettled([
    repositoryFor(agentA).deleteOwnedFlow(racingFlowA),
    repositoryFor(agentA).deleteOwnedFlow(racingFlowA),
  ]);
  assert.equal(
    racingDeletes.filter((result) => result.status === 'fulfilled').length,
    1
  );
  const rejectedRace = racingDeletes.find(
    (result) => result.status === 'rejected'
  );
  assert.equal(rejectedRace?.status, 'rejected');
  assert.equal(
    rejectedRace?.reason instanceof AppError && rejectedRace.reason.code,
    'not_found'
  );

  await assert.rejects(
    repositoryFor(agentA).deleteOwnedFlow(ownedFlowA),
    (error) => error instanceof AppError && error.code === 'not_found'
  );
  const pooledIdentity = requireSuccess(
    await queryDb('SELECT auth.uid()::text AS user_id'),
    'pooled identity reset probe'
  );
  assert.deepEqual(pooledIdentity.rows, [{ user_id: null }]);
  const noIdentity = requireSuccess(
    await queryDb(
      'SELECT count(flow.id)::int AS count FROM public.flows AS flow'
    ),
    'missing identity RLS probe'
  );
  assert.deepEqual(noIdentity.rows, [{ count: 0 }]);

  console.log(
    'PostgreSQL flow-delete persistence integration SUCCESS: forced RLS, NOBYPASSRLS, minimum grants, agent/owner/account isolation, concurrency, cascade assertions delegated to bootstrap post-probe, and identity cleanup.'
  );
} finally {
  await pool.end();
}
