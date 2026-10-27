import assert from 'node:assert/strict';
import { AppError } from '../../src/lib/db/errors.ts';
import { queryDb, withTransaction } from '../../src/lib/db/postgres-client.ts';
import { getPostgresPool } from '../../src/lib/db/postgres-pool.ts';
import { createPostgresAutomationUpdatePersistenceRepository } from '../../src/lib/repositories/automation-update-persistence.ts';

const agentA = '00000000-0000-4000-8000-000000000003';
const viewerA = '00000000-0000-4000-8000-000000000004';
const activeId = '30000000-0000-4000-8000-000000000001';
const draftId = '30000000-0000-4000-8000-000000000002';
const originalChildId = '40000000-0000-4000-8000-000000000002';
const pool = getPostgresPool();

function requireSuccess(result, label) {
  if (!result.ok) throw new Error(`${label} failed with ${result.error.code}`);
  return result.data;
}

function repositoryFor(userId) {
  return createPostgresAutomationUpdatePersistenceRepository(async () => ({
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

async function automation(userId, id) {
  const rows = await scopedRows(
    userId,
    `SELECT id::text AS id, user_id::text AS user_id,
            account_id::text AS account_id, name, description,
            trigger_type, trigger_config, is_active
     FROM public.automations WHERE id = $1`,
    [id]
  );
  return rows[0] ?? null;
}

async function steps(userId, id) {
  return scopedRows(
    userId,
    `SELECT id::text AS id, parent_step_id::text AS parent_step_id,
            branch, step_type, step_config, position
     FROM public.automation_steps WHERE automation_id = $1
     ORDER BY parent_step_id NULLS FIRST, branch, position, id`,
    [id]
  );
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
    { role: 'wacrm_automation_update_runtime', rolbypassrls: false },
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
          'automation_pending_executions',
          'automation_steps',
          'automations',
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
      'automation_pending_executions',
      'automation_steps',
      'automations',
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
      'automations.account_id',
      'automations.description',
      'automations.id',
      'automations.is_active',
      'automations.name',
      'automations.trigger_config',
      'automations.trigger_type',
      'automations.user_id',
    ].map((column) => `SELECT:${column}`),
    ...[
      'automations.description',
      'automations.is_active',
      'automations.name',
      'automations.trigger_config',
      'automations.trigger_type',
    ].map((column) => `UPDATE:${column}`),
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
         has_table_privilege(current_user, 'public.automations', 'UPDATE') AS automations_update,
         has_table_privilege(current_user, 'public.automations', 'DELETE') AS automations_delete,
         has_table_privilege(current_user, 'public.automation_steps', 'SELECT') AS steps_select,
         has_table_privilege(current_user, 'public.automation_steps', 'INSERT') AS steps_insert,
         has_table_privilege(current_user, 'public.automation_steps', 'UPDATE') AS steps_update,
         has_table_privilege(current_user, 'public.automation_steps', 'DELETE') AS steps_delete,
         has_table_privilege(current_user, 'public.automation_pending_executions', 'SELECT') AS pending_select`
    ),
    'broad privilege probe'
  );
  assert.deepEqual(broadPrivileges.rows, [
    {
      accounts_select: false,
      profiles_select: false,
      automations_select: false,
      automations_update: false,
      automations_delete: false,
      steps_select: false,
      steps_insert: false,
      steps_update: false,
      steps_delete: true,
      pending_select: false,
    },
  ]);

  assert.equal(
    requireSuccess(
      await queryDb(
        `SELECT has_column_privilege(current_user, 'public.automations', 'name', 'UPDATE') AS can_update_name,
                has_column_privilege(current_user, 'public.automations', 'user_id', 'UPDATE') AS can_update_owner,
                has_column_privilege(current_user, 'public.automations', 'updated_at', 'UPDATE') AS can_update_timestamp`
      ),
      'column privilege boundary probe'
    ).rows[0].can_update_name,
    true
  );
  const protectedColumns = requireSuccess(
    await queryDb(
      `SELECT has_column_privilege(current_user, 'public.automations', 'user_id', 'UPDATE') AS can_update_owner,
              has_column_privilege(current_user, 'public.automations', 'updated_at', 'UPDATE') AS can_update_timestamp`
    ),
    'protected automation column probe'
  );
  assert.deepEqual(protectedColumns.rows, [
    { can_update_owner: false, can_update_timestamp: false },
  ]);

  await assert.rejects(
    createPostgresAutomationUpdatePersistenceRepository(
      async () => null
    ).patchOwnedAutomation(activeId, { name: 'Unauthorized synthetic' }),
    (error) => error instanceof AppError && error.code === 'unauthorized'
  );
  await assert.rejects(
    repositoryFor(viewerA).patchOwnedAutomation(activeId, {
      name: 'Viewer synthetic',
    }),
    (error) => error instanceof AppError && error.code === 'forbidden'
  );
  await assert.rejects(
    repositoryFor(agentA).patchOwnedAutomation('not-a-uuid', {
      name: 'Invalid synthetic',
    }),
    (error) => error instanceof AppError && error.code === 'bad_request'
  );
  for (const id of [
    '30000000-0000-4000-8000-000000000003',
    '30000000-0000-4000-8000-000000000004',
    '30000000-0000-4000-8000-000000000005',
  ]) {
    await assert.rejects(
      repositoryFor(agentA).patchOwnedAutomation(id, { name: 'Not owned' }),
      (error) => error instanceof AppError && error.code === 'not_found'
    );
  }

  await repositoryFor(agentA).patchOwnedAutomation(activeId, {
    name: 'Synthetic active patched',
    unknown_field: 'ignored synthetic value',
  });
  const afterHeader = await automation(agentA, activeId);
  assert.equal(afterHeader.name, 'Synthetic active patched');
  assert.equal(afterHeader.description, 'Original description');
  assert.equal(afterHeader.is_active, true);

  const originalSteps = await steps(agentA, activeId);
  await assert.rejects(
    repositoryFor(agentA).patchOwnedAutomation(activeId, {
      name: 'Must roll back',
      is_active: false,
      steps: [{ step_type: 'synthetic_reject', step_config: {} }],
    }),
    (error) => error instanceof AppError && error.code === 'db_error'
  );
  assert.equal(
    (await automation(agentA, activeId)).name,
    'Synthetic active patched'
  );
  assert.equal((await automation(agentA, activeId)).is_active, true);
  assert.deepEqual(await steps(agentA, activeId), originalSteps);

  await assert.rejects(
    repositoryFor(agentA).patchOwnedAutomation(activeId, {
      name: 'Invalid active replacement',
      steps: [{ step_type: 'send_message', step_config: {} }],
    }),
    (error) => error instanceof AppError && error.code === 'bad_request'
  );
  assert.equal(
    (await automation(agentA, activeId)).name,
    'Synthetic active patched'
  );
  assert.deepEqual(await steps(agentA, activeId), originalSteps);

  await repositoryFor(agentA).patchOwnedAutomation(activeId, {
    is_active: false,
    steps: [
      {
        step_type: 'condition',
        step_config: { subject: 'message', operand: 'contains' },
        branches: {
          yes: [
            {
              step_type: 'send_message',
              step_config: { text: 'Replacement synthetic reply' },
            },
          ],
          no: [],
        },
      },
    ],
  });
  const replacement = await steps(agentA, activeId);
  assert.equal(replacement.length, 2);
  const replacementRoot = replacement.find(
    (row) => row.parent_step_id === null
  );
  const replacementChild = replacement.find(
    (row) => row.parent_step_id !== null
  );
  assert.ok(replacementRoot);
  assert.ok(replacementChild);
  assert.notEqual(replacementRoot.id, '40000000-0000-4000-8000-000000000001');
  assert.notEqual(replacementChild.id, originalChildId);
  assert.equal(replacementRoot.step_type, 'condition');
  assert.equal(replacementChild.parent_step_id, replacementRoot.id);
  assert.equal(replacementChild.branch, 'yes');
  assert.equal(replacementChild.position, 0);
  assert.equal((await automation(agentA, activeId)).is_active, false);

  await repositoryFor(agentA).patchOwnedAutomation(activeId, { steps: [] });
  assert.deepEqual(await steps(agentA, activeId), []);

  const invalidDraftBefore = await automation(agentA, draftId);
  await assert.rejects(
    repositoryFor(agentA).patchOwnedAutomation(draftId, {
      is_active: true,
      steps: [{ step_type: 'send_message', step_config: {} }],
    }),
    (error) => error instanceof AppError && error.code === 'bad_request'
  );
  assert.deepEqual(await automation(agentA, draftId), invalidDraftBefore);
  await repositoryFor(agentA).patchOwnedAutomation(draftId, {
    trigger_type: 'keyword_match',
    trigger_config: { keywords: ['synthetic'], match_type: 'exact' },
    is_active: true,
    steps: [
      { step_type: 'send_message', step_config: { text: 'Synthetic active' } },
    ],
  });
  assert.equal((await automation(agentA, draftId)).is_active, true);
  assert.equal((await steps(agentA, draftId)).length, 1);

  console.log(
    'PostgreSQL automation-update integration SUCCESS: forced RLS, NOBYPASSRLS, least grants, account/owner isolation, allowlist, active validation, partial fields, nested replacement, pending-step FK behavior, rollback, draft activation, and cleanup.'
  );
} finally {
  await pool.end();
}
