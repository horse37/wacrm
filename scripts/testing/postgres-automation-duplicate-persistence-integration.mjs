import assert from 'node:assert/strict';
import { AppError } from '../../src/lib/db/errors.ts';
import { queryDb } from '../../src/lib/db/postgres-client.ts';
import { getPostgresPool } from '../../src/lib/db/postgres-pool.ts';
import { createPostgresAutomationDuplicatePersistenceRepository } from '../../src/lib/repositories/automation-duplicate-persistence.ts';

const agentA = '00000000-0000-4000-8000-000000000003';
const viewerA = '00000000-0000-4000-8000-000000000004';
const mainAutomationA = '30000000-0000-4000-8000-000000000001';
const ownerAutomationA = '30000000-0000-4000-8000-000000000002';
const otherAccountAutomationB = '30000000-0000-4000-8000-000000000003';
const inconsistentCreatorAutomation = '30000000-0000-4000-8000-000000000004';
const emptyAutomationA = '30000000-0000-4000-8000-000000000005';
const malformedAutomationA = '30000000-0000-4000-8000-000000000006';
const rollbackAutomationA = '30000000-0000-4000-8000-000000000007';
const pool = getPostgresPool();

function requireSuccess(result, label) {
  if (!result.ok) throw new Error(`${label} failed with ${result.error.code}`);
  return result.data;
}

function repositoryFor(userId) {
  return createPostgresAutomationDuplicatePersistenceRepository(async () => ({
    userId,
  }));
}

async function stepsForAutomation(automationId) {
  return requireSuccess(
    await queryDb(
      `SELECT
         step.id::text AS id,
         step.parent_step_id::text AS parent_step_id,
         step.branch,
         step.step_type,
         step.step_config,
         step.position
       FROM public.automation_steps AS step
       WHERE step.automation_id = $1
       ORDER BY step.position ASC, step.id ASC`,
      [automationId]
    ),
    `automation step read for ${automationId}`
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
    { role: 'wacrm_automation_duplicate_runtime', rolbypassrls: false },
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
    ].map((column) => `SELECT:${column}`),
    ...[
      'automation_steps.automation_id',
      'automation_steps.branch',
      'automation_steps.id',
      'automation_steps.parent_step_id',
      'automation_steps.position',
      'automation_steps.step_config',
      'automation_steps.step_type',
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
    createPostgresAutomationDuplicatePersistenceRepository(
      async () => null
    ).duplicateOwnedAutomation(mainAutomationA),
    (error) => error instanceof AppError && error.code === 'unauthorized'
  );
  await assert.rejects(
    repositoryFor(viewerA).duplicateOwnedAutomation(mainAutomationA),
    (error) => error instanceof AppError && error.code === 'forbidden'
  );
  await assert.rejects(
    repositoryFor(agentA).duplicateOwnedAutomation('not-an-automation-id'),
    (error) => error instanceof AppError && error.code === 'bad_request'
  );
  for (const sourceId of [
    ownerAutomationA,
    otherAccountAutomationB,
    inconsistentCreatorAutomation,
  ]) {
    await assert.rejects(
      repositoryFor(agentA).duplicateOwnedAutomation(sourceId),
      (error) => error instanceof AppError && error.code === 'not_found'
    );
  }

  await assert.rejects(
    repositoryFor(agentA).duplicateOwnedAutomation(malformedAutomationA),
    (error) => error instanceof AppError && error.code === 'db_error'
  );
  const malformedCopyCount = requireSuccess(
    await queryDb(
      `SELECT count(automation.id)::int AS count
       FROM public.automations AS automation
       WHERE automation.name = 'Malformed tree (Copy)'`
    ),
    'malformed source rollback probe'
  );
  assert.deepEqual(malformedCopyCount.rows, [{ count: 0 }]);

  await assert.rejects(
    repositoryFor(agentA).duplicateOwnedAutomation(rollbackAutomationA),
    (error) => error instanceof AppError && error.code === 'db_error'
  );
  const rolledBackCopyCount = requireSuccess(
    await queryDb(
      `SELECT count(automation.id)::int AS count
       FROM public.automations AS automation
       WHERE automation.name = 'Rollback automation (Copy)'`
    ),
    'step failure parent rollback probe'
  );
  assert.deepEqual(rolledBackCopyCount.rows, [{ count: 0 }]);

  const copy =
    await repositoryFor(agentA).duplicateOwnedAutomation(mainAutomationA);
  assert.equal(copy.name, 'Synthetic main (Copy)');
  assert.equal(copy.user_id, agentA);
  assert.equal(copy.account_id, '10000000-0000-4000-8000-000000000001');
  assert.deepEqual(copy.trigger_config, { keywords: ['synthetic'] });
  assert.equal(copy.is_active, false);
  assert.equal(copy.execution_count, 0);
  assert.equal(copy.last_executed_at, null);
  assert.equal(typeof copy.created_at, 'string');

  const originalSteps = await stepsForAutomation(mainAutomationA);
  const duplicateSteps = await stepsForAutomation(copy.id);
  assert.equal(duplicateSteps.length, originalSteps.length);
  const copiedIdByPosition = new Map(
    duplicateSteps.map((step) => [step.position, step.id])
  );
  const originalIds = new Set(originalSteps.map((step) => step.id));
  for (const original of originalSteps) {
    const duplicate = duplicateSteps.find(
      (step) => step.position === original.position
    );
    assert.ok(duplicate);
    assert.equal(originalIds.has(duplicate.id), false);
    assert.equal(duplicate.branch, original.branch);
    assert.equal(duplicate.step_type, original.step_type);
    assert.deepEqual(duplicate.step_config, original.step_config);
    assert.equal(
      duplicate.parent_step_id,
      original.parent_step_id === null
        ? null
        : copiedIdByPosition.get(
            originalSteps.find((step) => step.id === original.parent_step_id)
              ?.position
          )
    );
  }

  const emptyCopy =
    await repositoryFor(agentA).duplicateOwnedAutomation(emptyAutomationA);
  assert.deepEqual(await stepsForAutomation(emptyCopy.id), []);

  const noIdentity = requireSuccess(
    await queryDb(
      'SELECT count(automation.id)::int AS count FROM public.automations AS automation'
    ),
    'missing identity RLS probe'
  );
  assert.deepEqual(noIdentity.rows, [{ count: 0 }]);

  console.log(
    'PostgreSQL automation-duplicate persistence integration SUCCESS: forced RLS, NOBYPASSRLS, exact column grants, creator/account isolation, invalid-tree fail-closed behavior, atomic rollback, inactive copy metadata, step remapping, and empty automation handling; pool identity cleanup runs separately.'
  );
} finally {
  await pool.end();
}
