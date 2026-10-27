import assert from 'node:assert/strict';
import { Pool } from 'pg';
import { AppError } from '../../src/lib/db/errors.ts';
import { queryDb, withTransaction } from '../../src/lib/db/postgres-client.ts';
import { getPostgresPool } from '../../src/lib/db/postgres-pool.ts';
import { createPostgresFlowNodeGraphReplaceRepository } from '../../src/lib/repositories/flow-node-graph-replace.ts';
import { createPostgresFlowStatusTransitionRepository } from '../../src/lib/repositories/flow-status-transition.ts';

const agentA = '00000000-0000-4000-8000-000000000002';
const viewerA = '00000000-0000-4000-8000-000000000003';
const agentB = '00000000-0000-4000-8000-000000000004';
const accountA = '10000000-0000-4000-8000-000000000001';
const accountB = '10000000-0000-4000-8000-000000000002';
const validFlow = '70000000-0000-4000-8000-000000000001';
const invalidFlow = '70000000-0000-4000-8000-000000000002';
const warningFlow = '70000000-0000-4000-8000-000000000003';
const flowB = '70000000-0000-4000-8000-000000000004';
const raceFlow = '70000000-0000-4000-8000-000000000005';
const pool = getPostgresPool();
const bootstrapUrl = process.env.BOOTSTRAP_DATABASE_URL;
if (!bootstrapUrl) throw new Error('BOOTSTRAP_DATABASE_URL is required');
const bootstrapPool = new Pool({ connectionString: bootstrapUrl, max: 2 });

function requireSuccess(result, label) {
  if (!result.ok) throw new Error(`${label} failed with ${result.error.code}`);
  return result.data;
}

function repositoryFor(userId) {
  return createPostgresFlowStatusTransitionRepository(async () => ({ userId }));
}

function graphRepositoryFor(userId) {
  return createPostgresFlowNodeGraphReplaceRepository(async () => ({ userId }));
}

async function waitForBootstrapProbe(sql, timeoutMs = 10_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const result = await bootstrapPool.query(sql);
    if (result.rows[0]?.present === true) return true;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  return false;
}

async function visibleFlowStatus(userId, flowId) {
  return withTransaction(async (transaction) => {
    await transaction.query(
      "SELECT set_config('request.jwt.claim.sub', $1, true)",
      [userId]
    );
    const result = await transaction.query(
      `SELECT flow.status
       FROM public.flows AS flow
       WHERE flow.id = $1`,
      [flowId]
    );
    return result.rows[0]?.status ?? null;
  });
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

try {
  const runtime = requireSuccess(
    await queryDb(
      `SELECT current_user AS role, rolbypassrls
       FROM pg_roles WHERE rolname = current_user`
    ),
    'runtime role probe'
  );
  assert.deepEqual(runtime.rows, [
    { role: 'wacrm_flow_status_runtime', rolbypassrls: false },
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
    ].map((column) => `SELECT:${column}`),
    ...[
      'flows.account_id',
      'flows.entry_node_id',
      'flows.id',
      'flows.name',
      'flows.status',
      'flows.trigger_config',
      'flows.trigger_type',
      'flows.user_id',
    ].map((column) => `SELECT:${column}`),
    ...['profiles.account_id', 'profiles.account_role', 'profiles.user_id'].map(
      (column) => `SELECT:${column}`
    ),
    ...['flows.status', 'flows.updated_at'].map((column) => `UPDATE:${column}`),
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
    createPostgresFlowStatusTransitionRepository(
      async () => null
    ).transitionForFlow(validFlow, 'active'),
    (error) => error instanceof AppError && error.code === 'unauthorized'
  );
  await assert.rejects(
    repositoryFor(viewerA).transitionForFlow(validFlow, 'active'),
    (error) => error instanceof AppError && error.code === 'forbidden'
  );
  await assert.rejects(
    repositoryFor(agentA).transitionForFlow(flowB, 'active'),
    (error) => error instanceof AppError && error.code === 'not_found'
  );
  await assert.rejects(
    repositoryFor(agentA).transitionForFlow('invalid', 'active'),
    (error) => error instanceof AppError && error.code === 'bad_request'
  );

  const activated = await repositoryFor(agentA).transitionForFlow(
    validFlow,
    'active'
  );
  assert.deepEqual(activated, {
    updated: true,
    flowId: validFlow,
    status: 'active',
    issues: [],
  });
  assert.equal(
    requireSuccess(
      await visibleFlowStatus(agentA, validFlow),
      'activated flow status'
    ),
    'active'
  );

  const blocked = await repositoryFor(agentA).transitionForFlow(
    invalidFlow,
    'active'
  );
  assert.equal(blocked.updated, false);
  assert.ok(blocked.issues.some((issue) => issue.severity === 'error'));
  assert.equal(
    requireSuccess(
      await visibleFlowStatus(agentA, invalidFlow),
      'blocked flow status'
    ),
    'draft'
  );

  const warning = await repositoryFor(agentA).transitionForFlow(
    warningFlow,
    'active'
  );
  assert.equal(warning.updated, true);
  assert.ok(warning.issues.some((issue) => issue.severity === 'warning'));
  assert.equal(
    requireSuccess(
      await visibleFlowStatus(agentA, warningFlow),
      'warning flow status'
    ),
    'active'
  );

  assert.equal(
    (await repositoryFor(agentA).transitionForFlow(invalidFlow, 'archived'))
      .updated,
    true
  );
  assert.equal(
    (await repositoryFor(agentA).transitionForFlow(invalidFlow, 'draft'))
      .updated,
    true
  );
  assert.equal(
    requireSuccess(
      await visibleFlowStatus(agentA, invalidFlow),
      'unconditional draft status'
    ),
    'draft'
  );

  assert.equal(
    requireSuccess(
      await visibleFlowCount(agentA, accountB),
      'cross-account flow isolation'
    ),
    0
  );
  assert.equal(
    requireSuccess(
      await visibleFlowStatus(agentB, flowB),
      'account B flow status isolation'
    ),
    'draft'
  );
  assert.equal(
    requireSuccess(
      await visibleFlowCount(agentA, accountA),
      'account A visible flow count'
    ),
    4
  );

  // Pause graph replacement after it has acquired the flow row lock but
  // before deleting the old start node. Activation must wait, then validate
  // the replacement graph rather than activating the earlier valid graph.
  const barrier = await bootstrapPool.connect();
  await barrier.query('SELECT pg_advisory_lock(20261020, 53426)');
  let replacementPromise;
  let transitionPromise;
  let replacementPaused = false;
  let activationWaitedForReplacement = false;
  try {
    replacementPromise = graphRepositoryFor(agentA).replaceForFlow(raceFlow, [
      {
        node_key: 'race_start',
        node_type: 'start',
        config: { next_node_key: 'missing' },
      },
      { node_key: 'race_end', node_type: 'end', config: {} },
    ]);
    replacementPaused = await waitForBootstrapProbe(
      `SELECT EXISTS (
         SELECT 1 FROM pg_locks
         WHERE locktype = 'advisory'
           AND granted = false
           AND classid = 20261020::oid
           AND objid = 53426::oid
           AND objsubid = 2
       ) AS present`
    );
    if (replacementPaused) {
      transitionPromise = repositoryFor(agentA).transitionForFlow(
        raceFlow,
        'active'
      );
      activationWaitedForReplacement = await waitForBootstrapProbe(
        `SELECT EXISTS (
           SELECT 1 FROM pg_stat_activity
           WHERE datname = current_database()
             AND application_name = 'wacrm-web'
             AND state = 'active'
             AND wait_event_type = 'Lock'
             AND query LIKE '%pg_advisory_xact_lock%'
         ) AS present`
      );
    }
  } finally {
    await barrier.query('SELECT pg_advisory_unlock(20261020, 53426)');
    barrier.release();
  }
  const concurrentResults = await Promise.allSettled([
    ...(replacementPromise ? [replacementPromise] : []),
    ...(transitionPromise ? [transitionPromise] : []),
  ]);
  assert.equal(
    replacementPaused,
    true,
    'graph replacement did not reach the barrier'
  );
  assert.equal(
    activationWaitedForReplacement,
    true,
    'activation did not wait for the in-flight graph replacement'
  );
  assert.equal(concurrentResults[0]?.status, 'fulfilled');
  assert.equal(concurrentResults[1]?.status, 'fulfilled');
  const concurrentActivation = concurrentResults[1].value;
  assert.equal(concurrentActivation.updated, false);
  assert.ok(
    concurrentActivation.issues.some((issue) => issue.severity === 'error')
  );
  assert.equal(
    requireSuccess(
      await visibleFlowStatus(agentA, raceFlow),
      'concurrent replacement activation status'
    ),
    'draft'
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
    'PostgreSQL flow status integration SUCCESS: forced RLS, NOBYPASSRLS, combined minimum grants, role/account isolation, validated activation, blocking issues, unconditional draft/archive, serialized graph replacement/activation, and identity cleanup.'
  );
} finally {
  await pool.end();
  await bootstrapPool.end();
}
