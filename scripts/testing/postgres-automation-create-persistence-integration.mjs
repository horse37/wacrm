import assert from 'node:assert/strict';
import { AppError } from '../../src/lib/db/errors.ts';
import { queryDb, withTransaction } from '../../src/lib/db/postgres-client.ts';
import { getPostgresPool } from '../../src/lib/db/postgres-pool.ts';
import { createPostgresAutomationCreatePersistenceRepository } from '../../src/lib/repositories/automation-create-persistence.ts';

const agentA = '00000000-0000-4000-8000-000000000003';
const viewerA = '00000000-0000-4000-8000-000000000004';
const accountA = '10000000-0000-4000-8000-000000000001';
const pool = getPostgresPool();

function requireSuccess(result, label) {
  if (!result.ok) throw new Error(`${label} failed with ${result.error.code}`);
  return result.data;
}

function repositoryFor(userId) {
  return createPostgresAutomationCreatePersistenceRepository(async () => ({
    userId,
  }));
}

async function scopedRows(userId, sql, values = []) {
  return requireSuccess(
    await withTransaction(async (transaction) => {
      await transaction.query(
        "SELECT set_config('request.jwt.claim.sub', $1, true)",
        [userId]
      );
      return transaction.query(sql, values);
    }),
    'scoped PostgreSQL query'
  ).rows;
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
    { role: 'wacrm_automation_create_runtime', rolbypassrls: false },
  ]);

  const rls = requireSuccess(
    await queryDb(
      `SELECT c.relname, c.relrowsecurity, c.relforcerowsecurity
       FROM pg_class AS c
       INNER JOIN pg_namespace AS n ON n.oid = c.relnamespace
       WHERE n.nspname = 'public'
         AND c.relname = ANY($1::text[])
       ORDER BY c.relname`,
      [['accounts', 'automation_steps', 'automations', 'profiles']]
    ),
    'forced RLS probe'
  );
  assert.deepEqual(
    rls.rows,
    ['accounts', 'automation_steps', 'automations', 'profiles'].map(
      (relname) => ({
        relname,
        relrowsecurity: true,
        relforcerowsecurity: true,
      })
    )
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
      'automations.account_id',
      'automations.created_at',
      'automations.description',
      'automations.execution_count',
      'automations.id',
      'automations.is_active',
      'automations.last_executed_at',
      'automations.name',
      'automations.trigger_config',
      'automations.trigger_type',
      'automations.updated_at',
      'automations.user_id',
    ].map((column) => `SELECT:${column}`),
    ...[
      'automations.account_id',
      'automations.description',
      'automations.id',
      'automations.is_active',
      'automations.name',
      'automations.trigger_config',
      'automations.trigger_type',
      'automations.user_id',
    ].map((column) => `INSERT:${column}`),
    ...[
      'automation_steps.automation_id',
      'automation_steps.branch',
      'automation_steps.id',
      'automation_steps.parent_step_id',
      'automation_steps.position',
      'automation_steps.step_config',
      'automation_steps.step_type',
    ].flatMap((column) => [`INSERT:${column}`, `SELECT:${column}`]),
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

  const broadPrivileges = requireSuccess(
    await queryDb(
      `SELECT
         has_table_privilege(current_user, 'public.accounts', 'SELECT') AS accounts_select,
         has_table_privilege(current_user, 'public.profiles', 'SELECT') AS profiles_select,
         has_table_privilege(current_user, 'public.automations', 'SELECT') AS automations_select,
         has_table_privilege(current_user, 'public.automations', 'INSERT') AS automations_insert,
         has_table_privilege(current_user, 'public.automations', 'UPDATE') AS automations_update,
         has_table_privilege(current_user, 'public.automations', 'DELETE') AS automations_delete,
         has_table_privilege(current_user, 'public.automation_steps', 'SELECT') AS steps_select,
         has_table_privilege(current_user, 'public.automation_steps', 'INSERT') AS steps_insert,
         has_table_privilege(current_user, 'public.automation_steps', 'UPDATE') AS steps_update,
         has_table_privilege(current_user, 'public.automation_steps', 'DELETE') AS steps_delete`
    ),
    'broad privilege probe'
  );
  assert.deepEqual(broadPrivileges.rows, [
    {
      accounts_select: false,
      profiles_select: false,
      automations_select: false,
      automations_insert: false,
      automations_update: false,
      automations_delete: false,
      steps_select: false,
      steps_insert: false,
      steps_update: false,
      steps_delete: false,
    },
  ]);

  await assert.rejects(
    createPostgresAutomationCreatePersistenceRepository(
      async () => null
    ).createAutomation({
      name: 'Synthetic unauthorized',
      trigger_type: 'new_message_received',
    }),
    (error) => error instanceof AppError && error.code === 'unauthorized'
  );
  await assert.rejects(
    repositoryFor(viewerA).createAutomation({
      name: 'Synthetic viewer',
      trigger_type: 'new_message_received',
    }),
    (error) => error instanceof AppError && error.code === 'forbidden'
  );

  const active = await repositoryFor(agentA).createAutomation({
    name: 'Synthetic active tree',
    description: 'Synthetic data only',
    trigger_type: 'keyword_match',
    trigger_config: { match_type: 'contains', keywords: ['hello'] },
    is_active: true,
    user_id: '00000000-0000-4000-8000-000000000001',
    account_id: '10000000-0000-4000-8000-000000000002',
    steps: [
      {
        step_type: 'condition',
        step_config: { subject: 'message', operand: 'contains' },
        branches: {
          yes: [
            {
              step_type: 'send_message',
              step_config: { text: 'Synthetic reply' },
            },
          ],
          no: [],
        },
      },
    ],
  });
  assert.equal(active.user_id, agentA);
  assert.equal(active.account_id, accountA);
  assert.equal(active.is_active, true);
  assert.equal(active.execution_count, 0);
  assert.equal(active.last_executed_at, null);
  assert.deepEqual(active.trigger_config, {
    match_type: 'contains',
    keywords: ['hello'],
  });
  assert.equal(typeof active.created_at, 'string');
  const treeRows = await scopedRows(
    agentA,
    `SELECT id::text AS id, parent_step_id::text AS parent_step_id,
            branch, step_type, step_config, position
     FROM public.automation_steps WHERE automation_id = $1
     ORDER BY position, id`,
    [active.id]
  );
  assert.equal(treeRows.length, 2);
  const treeRoot = treeRows.find((row) => row.parent_step_id === null);
  const treeChild = treeRows.find((row) => row.parent_step_id !== null);
  assert.ok(treeRoot);
  assert.ok(treeChild);
  assert.notEqual(treeRoot.id, treeChild.id);
  assert.equal(treeRoot.position, 0);
  assert.equal(treeChild.parent_step_id, treeRoot.id);
  assert.equal(treeChild.branch, 'yes');
  assert.equal(treeChild.position, 0);

  const flat = await repositoryFor(agentA).createAutomation({
    name: 'Synthetic flat template',
    trigger_type: 'new_message_received',
    trigger_config: {},
    is_active: true,
    steps: [
      {
        step_type: 'condition',
        step_config: { subject: 'message', operand: 'contains' },
      },
      {
        step_type: 'send_message',
        step_config: { text: 'Synthetic flat reply' },
        parent_index: 0,
        branch: 'no',
      },
    ],
  });
  const flatRows = await scopedRows(
    agentA,
    `SELECT id::text AS id, parent_step_id::text AS parent_step_id,
            branch, step_type, position
     FROM public.automation_steps WHERE automation_id = $1
     ORDER BY position, id`,
    [flat.id]
  );
  const flatRoot = flatRows.find((row) => row.parent_step_id === null);
  const flatChild = flatRows.find((row) => row.parent_step_id !== null);
  assert.ok(flatRoot);
  assert.ok(flatChild);
  assert.equal(flatChild.parent_step_id, flatRoot.id);
  assert.equal(flatChild.branch, 'no');
  assert.equal(flat.is_active, true);

  const draft = await repositoryFor(agentA).createAutomation({
    name: 'Synthetic empty draft',
    trigger_type: 'keyword_match',
    is_active: false,
    steps: [],
  });
  assert.equal(draft.is_active, false);
  assert.equal(draft.description, null);
  assert.deepEqual(draft.trigger_config, {});
  assert.deepEqual(
    await scopedRows(
      agentA,
      'SELECT id FROM public.automation_steps WHERE automation_id = $1',
      [draft.id]
    ),
    []
  );

  const beforeRejectedCreate = await scopedRows(
    agentA,
    'SELECT count(*)::int AS count FROM public.automations'
  );
  await assert.rejects(
    repositoryFor(agentA).createAutomation({
      name: 'Synthetic invalid active',
      trigger_type: 'keyword_match',
      trigger_config: { keywords: [], match_type: 'wrong' },
      is_active: true,
      steps: [{ step_type: 'send_message', step_config: {} }],
    }),
    (error) => error instanceof AppError && error.code === 'bad_request'
  );
  await assert.rejects(
    repositoryFor(agentA).createAutomation({
      name: 'Synthetic invalid parent',
      trigger_type: 'new_message_received',
      is_active: false,
      steps: [
        { step_type: 'send_message', step_config: { text: 'root' } },
        {
          step_type: 'send_message',
          step_config: { text: 'child' },
          parent_index: 0,
          branch: 'yes',
        },
      ],
    }),
    (error) => error instanceof AppError && error.code === 'bad_request'
  );
  const afterRejectedCreate = await scopedRows(
    agentA,
    'SELECT count(*)::int AS count FROM public.automations'
  );
  assert.deepEqual(afterRejectedCreate, beforeRejectedCreate);

  await assert.rejects(
    repositoryFor(agentA).createAutomation({
      name: 'Synthetic rollback',
      trigger_type: 'new_message_received',
      is_active: false,
      steps: [{ step_type: 'synthetic_reject', step_config: {} }],
    }),
    (error) => error instanceof AppError && error.code === 'db_error'
  );
  const rollbackRows = await scopedRows(
    agentA,
    "SELECT count(*)::int AS count FROM public.automations WHERE name = 'Synthetic rollback'"
  );
  assert.deepEqual(rollbackRows, [{ count: 0 }]);

  const noIdentity = requireSuccess(
    await queryDb(
      'SELECT count(automation.id)::int AS count FROM public.automations AS automation'
    ),
    'missing identity RLS probe'
  );
  assert.deepEqual(noIdentity.rows, [{ count: 0 }]);

  console.log(
    'PostgreSQL automation-create integration SUCCESS: forced RLS, NOBYPASSRLS, exact grants, role/account-derived identity, nested/flat steps, active validation, draft defaults, rollback, and RLS isolation; same-connection identity cleanup runs separately.'
  );
} finally {
  await pool.end();
}
