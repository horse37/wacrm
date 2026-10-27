import assert from 'node:assert/strict';
import { AppError } from '../../src/lib/db/errors.ts';
import { queryDb, withTransaction } from '../../src/lib/db/postgres-client.ts';
import { getPostgresPool } from '../../src/lib/db/postgres-pool.ts';
import { createPostgresFlowCreatePersistenceRepository } from '../../src/lib/repositories/flow-create-persistence.ts';

const agentA = '00000000-0000-4000-8000-000000000002';
const viewerA = '00000000-0000-4000-8000-000000000003';
const agentB = '00000000-0000-4000-8000-000000000004';
const accountA = '10000000-0000-4000-8000-000000000001';
const accountB = '10000000-0000-4000-8000-000000000002';
const pool = getPostgresPool();

function requireSuccess(result, label) {
  if (!result.ok) throw new Error(`${label} failed with ${result.error.code}`);
  return result.data;
}

function repositoryFor(userId) {
  return createPostgresFlowCreatePersistenceRepository(async () => ({
    userId,
  }));
}

async function visibleFlowCount(userId, accountId) {
  return withTransaction(async (transaction) => {
    await transaction.query(
      "SELECT set_config('request.jwt.claim.sub', $1, true)",
      [userId]
    );
    const result = await transaction.query(
      `SELECT count(flow.id)::int AS count
       FROM public.flows AS flow
       WHERE flow.account_id = $1`,
      [accountId]
    );
    return result.rows[0]?.count;
  });
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
    { role: 'wacrm_flow_create_runtime', rolbypassrls: false },
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
      'flow_nodes.config',
      'flow_nodes.flow_id',
      'flow_nodes.node_key',
      'flow_nodes.node_type',
      'flow_nodes.position_x',
      'flow_nodes.position_y',
    ].map((column) => `INSERT:${column}`),
    ...[
      'flow_nodes.config',
      'flow_nodes.flow_id',
      'flow_nodes.node_key',
      'flow_nodes.node_type',
      'flow_nodes.position_x',
      'flow_nodes.position_y',
    ].map((column) => `SELECT:${column}`),
    ...['flows.account_id', 'flows.id'].map((column) => `SELECT:${column}`),
    ...[
      'flows.account_id',
      'flows.description',
      'flows.entry_node_id',
      'flows.fallback_policy',
      'flows.name',
      'flows.status',
      'flows.trigger_config',
      'flows.trigger_type',
      'flows.user_id',
    ].map((column) => `INSERT:${column}`),
    ...['profiles.account_id', 'profiles.account_role', 'profiles.user_id'].map(
      (column) => `SELECT:${column}`
    ),
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
    createPostgresFlowCreatePersistenceRepository(async () => null).createDraft(
      { name: 'Synthetic unauthorized' }
    ),
    (error) => error instanceof AppError && error.code === 'unauthorized'
  );
  await assert.rejects(
    repositoryFor(viewerA).createDraft({ name: 'Synthetic viewer denied' }),
    (error) => error instanceof AppError && error.code === 'forbidden'
  );
  await assert.rejects(
    repositoryFor(agentA).createDraft({
      name: 'Synthetic account injection',
      account_id: accountB,
    }),
    (error) => error instanceof AppError && error.code === 'bad_request'
  );

  const plainFlowId = await repositoryFor(agentA).createDraft({
    name: ' Synthetic plain draft ',
    description: null,
  });
  assert.match(plainFlowId, /^[0-9a-f-]{36}$/);
  assert.equal(
    requireSuccess(
      await visibleNodeCount(agentA, plainFlowId),
      'plain node visibility'
    ),
    0
  );

  const templateFlowId = await repositoryFor(agentA).createDraft({
    name: 'Synthetic template clone',
    description: 'Synthetic only',
    trigger_type: 'manual',
    trigger_config: { marker: 'synthetic' },
    entry_node_id: 'start',
    fallback_policy: { on_unknown_reply: 'handoff' },
    nodes: [
      {
        node_key: 'start',
        node_type: 'start',
        config: { next_node_key: 'media' },
        position_x: -15,
        position_y: 25,
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
      { node_key: 'end', node_type: 'end', config: {} },
    ],
  });
  assert.equal(
    requireSuccess(
      await visibleNodeCount(agentA, templateFlowId),
      'template node visibility'
    ),
    3
  );

  const accountACountBeforeFailure = requireSuccess(
    await visibleFlowCount(agentA, accountA),
    'account A pre-rollback count'
  );
  await assert.rejects(
    repositoryFor(agentA).createDraft({
      name: 'Synthetic rollback draft',
      nodes: [
        { node_key: 'created_before_failure', node_type: 'end', config: {} },
        { node_key: 'synthetic_fail', node_type: 'end', config: {} },
      ],
    }),
    (error) => error instanceof AppError && error.code === 'db_error'
  );
  assert.equal(
    requireSuccess(
      await visibleFlowCount(agentA, accountA),
      'account A rollback count'
    ),
    accountACountBeforeFailure
  );

  const flowBId = await repositoryFor(agentB).createDraft({
    name: 'Synthetic account B draft',
  });
  assert.equal(
    requireSuccess(
      await visibleFlowCount(agentA, accountB),
      'cross-account flow isolation'
    ),
    0
  );
  assert.equal(
    requireSuccess(
      await visibleFlowCount(agentB, accountB),
      'account B flow visibility'
    ),
    1
  );
  assert.equal(
    requireSuccess(
      await visibleFlowCount(agentA, accountA),
      'account A flow visibility'
    ),
    2
  );
  assert.equal(
    requireSuccess(
      await visibleNodeCount(agentB, flowBId),
      'account B node visibility'
    ),
    0
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
    'PostgreSQL flow creation integration SUCCESS: forced RLS, NOBYPASSRLS, minimum grants, role/account isolation, draft creation, template graph persistence, atomic rollback, and identity cleanup.'
  );
} finally {
  await pool.end();
}
