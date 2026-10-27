import assert from 'node:assert/strict';
import { AppError } from '../../src/lib/db/errors.ts';
import { queryDb } from '../../src/lib/db/postgres-client.ts';
import { getPostgresPool } from '../../src/lib/db/postgres-pool.ts';
import { createPostgresFlowHeaderUpdateRepository } from '../../src/lib/repositories/flow-header-update.ts';

const agentA = '00000000-0000-4000-8000-000000000002';
const viewerA = '00000000-0000-4000-8000-000000000003';
const agentB = '00000000-0000-4000-8000-000000000004';
const flowA = '70000000-0000-4000-8000-000000000001';
const flowB = '70000000-0000-4000-8000-000000000002';
const pool = getPostgresPool();

function requireSuccess(result, label) {
  if (!result.ok) throw new Error(`${label} failed with ${result.error.code}`);
  return result.data;
}

function repositoryFor(userId) {
  return createPostgresFlowHeaderUpdateRepository(async () => ({ userId }));
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
    { role: 'wacrm_flow_header_runtime', rolbypassrls: false },
  ]);

  const rls = requireSuccess(
    await queryDb(
      `SELECT c.relname, c.relrowsecurity, c.relforcerowsecurity
       FROM pg_class AS c
       INNER JOIN pg_namespace AS n ON n.oid = c.relnamespace
       WHERE n.nspname = 'public'
         AND c.relname = ANY($1::text[])
       ORDER BY c.relname`,
      [['accounts', 'flows', 'profiles']]
    ),
    'forced RLS probe'
  );
  assert.deepEqual(
    rls.rows,
    ['accounts', 'flows', 'profiles'].map((relname) => ({
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
    ...[
      'flows.description',
      'flows.entry_node_id',
      'flows.fallback_policy',
      'flows.name',
      'flows.trigger_config',
      'flows.trigger_type',
      'flows.updated_at',
    ].map((column) => `UPDATE:${column}`),
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
  assert.deepEqual(tableGrants.rows, []);

  await assert.rejects(
    createPostgresFlowHeaderUpdateRepository(async () => null).updateForFlow(
      flowA,
      { name: 'Unauthorized synthetic update' }
    ),
    (error) => error instanceof AppError && error.code === 'unauthorized'
  );
  await assert.rejects(
    repositoryFor(viewerA).updateForFlow(flowA, {
      name: 'Viewer synthetic update',
    }),
    (error) => error instanceof AppError && error.code === 'forbidden'
  );
  await assert.rejects(
    repositoryFor(agentA).updateForFlow('not-a-flow-id', {
      name: 'Invalid synthetic update',
    }),
    (error) => error instanceof AppError && error.code === 'bad_request'
  );
  await assert.rejects(
    repositoryFor(agentA).updateForFlow(flowB, {
      name: 'Cross-account synthetic update',
    }),
    (error) => error instanceof AppError && error.code === 'not_found'
  );

  await repositoryFor(agentA).updateForFlow(flowA, {
    name: 'Updated synthetic flow A',
    description: null,
    trigger_type: 'manual',
    trigger_config: { keywords: ['synthetic'] },
    entry_node_id: 'start',
    fallback_policy: { on_exhaust: 'handoff' },
  });
  await repositoryFor(agentB).updateForFlow(flowB, {
    name: 'Updated synthetic flow B',
  });

  const deniedStatusUpdate = await queryDb(
    'UPDATE public.flows SET status = $1 WHERE id = $2',
    ['active', flowB]
  );
  assert.equal(deniedStatusUpdate.ok, false);

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
    'PostgreSQL flow-header update integration SUCCESS: forced RLS, NOBYPASSRLS, exact column grants, account/role isolation, allowlisted header update, status denial, and identity cleanup.'
  );
} finally {
  await pool.end();
}
