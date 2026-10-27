import assert from 'node:assert/strict';
import { AppError } from '../../src/lib/db/errors.ts';
import { queryDb, withTransaction } from '../../src/lib/db/postgres-client.ts';
import { getPostgresPool } from '../../src/lib/db/postgres-pool.ts';
import { createPostgresFlowNodeGraphReplaceRepository } from '../../src/lib/repositories/flow-node-graph-replace.ts';

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
  return createPostgresFlowNodeGraphReplaceRepository(async () => ({ userId }));
}

async function visibleNodeCount(userId, flowId) {
  return withTransaction(async (transaction) => {
    await transaction.query(
      "SELECT set_config('request.jwt.claim.sub', $1, true)",
      [userId]
    );
    const result = await transaction.query(
      `SELECT count(node.flow_id)::int AS count
       FROM public.flow_nodes AS node
       WHERE node.flow_id = $1`,
      [flowId]
    );
    return result.rows[0]?.count;
  });
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
    { role: 'wacrm_flow_node_runtime', rolbypassrls: false },
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
  assert.deepEqual(
    rls.rows,
    ['accounts', 'flow_nodes', 'flows', 'profiles'].map((relname) => ({
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
      'flow_nodes.flow_id',
      'flows.account_id',
      'flows.id',
      'flows.user_id',
      'profiles.account_id',
      'profiles.account_role',
      'profiles.user_id',
    ].map((column) => `SELECT:${column}`),
    ...[
      'flow_nodes.config',
      'flow_nodes.flow_id',
      'flow_nodes.node_key',
      'flow_nodes.node_type',
      'flow_nodes.position_x',
      'flow_nodes.position_y',
    ].map((column) => `INSERT:${column}`),
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
    { table_name: 'flow_nodes', privilege_type: 'DELETE' },
  ]);

  await assert.rejects(
    createPostgresFlowNodeGraphReplaceRepository(
      async () => null
    ).replaceForFlow(flowA, []),
    (error) => error instanceof AppError && error.code === 'unauthorized'
  );
  await assert.rejects(
    repositoryFor(viewerA).replaceForFlow(flowA, []),
    (error) => error instanceof AppError && error.code === 'forbidden'
  );
  await assert.rejects(
    repositoryFor(agentA).replaceForFlow(flowB, []),
    (error) => error instanceof AppError && error.code === 'not_found'
  );
  await assert.rejects(
    repositoryFor(agentA).replaceForFlow(flowA, [
      { node_key: 'first', node_type: 'end', config: {} },
      { node_key: 'synthetic_fail', node_type: 'end', config: {} },
    ]),
    (error) => error instanceof AppError && error.code === 'db_error'
  );

  const afterRollback = requireSuccess(
    await visibleNodeCount(agentA, flowA),
    'rollback probe'
  );
  assert.equal(afterRollback, 1);

  await repositoryFor(agentA).replaceForFlow(flowA, [
    {
      node_key: 'start',
      node_type: 'start',
      config: { next_node_key: 'fetch' },
      position_x: -12,
      position_y: 24,
    },
    {
      node_key: 'fetch',
      node_type: 'http_fetch',
      config: { url: 'https://example.invalid/synthetic' },
    },
    {
      node_key: 'media',
      node_type: 'send_media',
      config: {
        media_type: 'image',
        media_url: 'https://example.invalid/synthetic.png',
        next_node_key: 'end',
      },
    },
  ]);
  await repositoryFor(agentB).replaceForFlow(flowB, []);

  const deniedHeaderUpdate = await queryDb(
    'UPDATE public.flows SET account_id = $1 WHERE id = $2',
    ['10000000-0000-4000-8000-000000000001', flowB]
  );
  assert.equal(deniedHeaderUpdate.ok, false);

  const pooledIdentity = requireSuccess(
    await queryDb('SELECT auth.uid()::text AS user_id'),
    'pooled identity reset probe'
  );
  assert.deepEqual(pooledIdentity.rows, [{ user_id: null }]);
  const noIdentity = requireSuccess(
    await queryDb(
      'SELECT count(node.flow_id)::int AS count FROM public.flow_nodes AS node'
    ),
    'missing identity RLS probe'
  );
  assert.deepEqual(noIdentity.rows, [{ count: 0 }]);

  console.log(
    'PostgreSQL flow-node graph replacement integration SUCCESS: forced RLS, NOBYPASSRLS, minimum grants, account/role isolation, atomic rollback/replacement, empty graph, and identity cleanup.'
  );
} finally {
  await pool.end();
}
