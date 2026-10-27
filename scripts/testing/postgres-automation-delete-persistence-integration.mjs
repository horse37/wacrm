import assert from 'node:assert/strict';
import { AppError } from '../../src/lib/db/errors.ts';
import { queryDb } from '../../src/lib/db/postgres-client.ts';
import { getPostgresPool } from '../../src/lib/db/postgres-pool.ts';
import { createPostgresAutomationDeletePersistenceRepository } from '../../src/lib/repositories/automation-delete-persistence.ts';

const agentA = '00000000-0000-4000-8000-000000000003';
const viewerA = '00000000-0000-4000-8000-000000000004';
const ownedAutomationA = '30000000-0000-4000-8000-000000000001';
const ownerAutomationA = '30000000-0000-4000-8000-000000000002';
const otherAccountAutomationB = '30000000-0000-4000-8000-000000000003';
const inconsistentCreatorAutomation = '30000000-0000-4000-8000-000000000004';
const racingAutomationA = '30000000-0000-4000-8000-000000000005';
const viewerAutomationA = '30000000-0000-4000-8000-000000000006';
const pool = getPostgresPool();

function requireSuccess(result, label) {
  if (!result.ok) throw new Error(`${label} failed with ${result.error.code}`);
  return result.data;
}

function repositoryFor(userId) {
  return createPostgresAutomationDeletePersistenceRepository(async () => ({
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
    { role: 'wacrm_automation_delete_runtime', rolbypassrls: false },
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
          'automation_logs',
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
      'automation_logs',
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
      'automations.id',
      'automations.user_id',
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
    { table_name: 'automations', privilege_type: 'DELETE' },
  ]);

  for (const table of [
    'automation_steps',
    'automation_logs',
    'automation_pending_executions',
  ]) {
    const directPrivileges = requireSuccess(
      await queryDb(
        `SELECT
           has_table_privilege(current_user, $1, 'SELECT') AS can_select,
           has_table_privilege(current_user, $1, 'INSERT') AS can_insert,
           has_table_privilege(current_user, $1, 'UPDATE') AS can_update,
           has_table_privilege(current_user, $1, 'DELETE') AS can_delete`,
        [`public.${table}`]
      ),
      `child privilege probe for ${table}`
    );
    assert.deepEqual(directPrivileges.rows, [
      {
        can_select: false,
        can_insert: false,
        can_update: false,
        can_delete: false,
      },
    ]);
  }

  await assert.rejects(
    createPostgresAutomationDeletePersistenceRepository(
      async () => null
    ).deleteOwnedAutomation(ownedAutomationA),
    (error) => error instanceof AppError && error.code === 'unauthorized'
  );
  await assert.rejects(
    repositoryFor(viewerA).deleteOwnedAutomation(viewerAutomationA),
    (error) => error instanceof AppError && error.code === 'forbidden'
  );
  await assert.rejects(
    repositoryFor(agentA).deleteOwnedAutomation('not-an-automation-id'),
    (error) => error instanceof AppError && error.code === 'bad_request'
  );
  await assert.rejects(
    repositoryFor(agentA).deleteOwnedAutomation(ownerAutomationA),
    (error) => error instanceof AppError && error.code === 'not_found'
  );
  await assert.rejects(
    repositoryFor(agentA).deleteOwnedAutomation(otherAccountAutomationB),
    (error) => error instanceof AppError && error.code === 'not_found'
  );
  await assert.rejects(
    repositoryFor(agentA).deleteOwnedAutomation(inconsistentCreatorAutomation),
    (error) => error instanceof AppError && error.code === 'not_found'
  );

  await repositoryFor(agentA).deleteOwnedAutomation(ownedAutomationA);
  const racingDeletes = await Promise.allSettled([
    repositoryFor(agentA).deleteOwnedAutomation(racingAutomationA),
    repositoryFor(agentA).deleteOwnedAutomation(racingAutomationA),
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
    repositoryFor(agentA).deleteOwnedAutomation(ownedAutomationA),
    (error) => error instanceof AppError && error.code === 'not_found'
  );
  const noIdentity = requireSuccess(
    await queryDb(
      'SELECT count(automation.id)::int AS count FROM public.automations AS automation'
    ),
    'missing identity RLS probe'
  );
  assert.deepEqual(noIdentity.rows, [{ count: 0 }]);

  console.log(
    'PostgreSQL automation-delete persistence integration SUCCESS: forced RLS, NOBYPASSRLS, minimum grants, agent/owner/account/profile isolation, concurrent delete, and anonymous RLS behavior; bootstrap post-probe verifies all cascades.'
  );
} finally {
  await pool.end();
}
