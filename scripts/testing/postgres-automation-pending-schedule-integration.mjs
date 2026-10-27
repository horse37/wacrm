import assert from 'node:assert/strict';
import { AppError } from '../../src/lib/db/errors.ts';
import { queryDb } from '../../src/lib/db/postgres-client.ts';
import { getPostgresPool } from '../../src/lib/db/postgres-pool.ts';
import { createPostgresAutomationPendingScheduleRepository } from '../../src/lib/repositories/automation-pending-schedule.ts';

const pool = getPostgresPool();
const repository = createPostgresAutomationPendingScheduleRepository();
const validInput = {
  automationId: '30000000-0000-4000-8000-000000000001',
  accountId: '10000000-0000-4000-8000-000000000001',
  userId: '00000000-0000-4000-8000-000000000001',
  contactId: '50000000-0000-4000-8000-000000000001',
  logId: '60000000-0000-4000-8000-000000000001',
  parentStepId: '70000000-0000-4000-8000-000000000001',
  branch: 'yes',
  nextStepPosition: 4,
  context: { message_text: 'Synthetic fixture', vars: { source: 'docker' } },
  runAt: new Date('2026-10-20T12:00:00.000Z'),
};

function requireSuccess(result, label) {
  if (!result.ok) throw new Error(`${label} failed with ${result.error.code}`);
  return result.data;
}

try {
  const serverVersion = requireSuccess(
    await queryDb('SHOW server_version_num'),
    'PostgreSQL version probe'
  );
  assert.match(serverVersion.rows[0].server_version_num, /^16/);

  const runtime = requireSuccess(
    await queryDb(
      `SELECT current_user AS role, rolbypassrls
       FROM pg_roles WHERE rolname = current_user`
    ),
    'runtime role probe'
  );
  assert.deepEqual(runtime.rows, [
    { role: 'wacrm_automation_schedule_job', rolbypassrls: false },
  ]);

  const relation = requireSuccess(
    await queryDb(
      `SELECT relrowsecurity, relforcerowsecurity
       FROM pg_class
       WHERE oid = 'public.automation_pending_executions'::regclass`
    ),
    'forced RLS probe'
  );
  assert.deepEqual(relation.rows, [
    { relrowsecurity: true, relforcerowsecurity: true },
  ]);

  const tableGrants = requireSuccess(
    await queryDb(
      `SELECT table_name, privilege_type
       FROM information_schema.role_table_grants
       WHERE grantee = current_user`
    ),
    'table-level grant probe'
  );
  assert.deepEqual(tableGrants.rows, []);

  const columnGrants = requireSuccess(
    await queryDb(
      `SELECT column_name, privilege_type
       FROM information_schema.role_column_grants
       WHERE grantee = current_user
         AND table_name = 'automation_pending_executions'
       ORDER BY column_name, privilege_type`
    ),
    'column-level grant probe'
  );
  assert.deepEqual(columnGrants.rows, [
    { column_name: 'account_id', privilege_type: 'INSERT' },
    { column_name: 'automation_id', privilege_type: 'INSERT' },
    { column_name: 'branch', privilege_type: 'INSERT' },
    { column_name: 'contact_id', privilege_type: 'INSERT' },
    { column_name: 'context', privilege_type: 'INSERT' },
    { column_name: 'id', privilege_type: 'SELECT' },
    { column_name: 'log_id', privilege_type: 'INSERT' },
    { column_name: 'next_step_position', privilege_type: 'INSERT' },
    { column_name: 'parent_step_id', privilege_type: 'INSERT' },
    { column_name: 'run_at', privilege_type: 'INSERT' },
    { column_name: 'status', privilege_type: 'INSERT' },
    { column_name: 'user_id', privilege_type: 'INSERT' },
  ]);

  const tablePrivileges = requireSuccess(
    await queryDb(
      `SELECT
         has_table_privilege(current_user, 'public.automation_pending_executions', 'SELECT') AS table_select,
         has_table_privilege(current_user, 'public.automation_pending_executions', 'INSERT') AS table_insert,
         has_table_privilege(current_user, 'public.automation_pending_executions', 'UPDATE') AS table_update,
         has_table_privilege(current_user, 'public.automation_pending_executions', 'DELETE') AS table_delete`
    ),
    'table privilege probe'
  );
  assert.deepEqual(tablePrivileges.rows, [
    {
      table_select: false,
      table_insert: false,
      table_update: false,
      table_delete: false,
    },
  ]);

  const id = await repository.schedule(validInput);
  assert.match(
    id,
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
  );
  const visible = requireSuccess(
    await queryDb(
      `SELECT id::text AS id
       FROM public.automation_pending_executions
       WHERE id = $1`,
      [id]
    ),
    'inserted row visibility'
  );
  assert.deepEqual(visible.rows, [{ id }]);

  const defaultsId = await repository.schedule({
    ...validInput,
    contactId: null,
    logId: null,
    parentStepId: null,
    branch: null,
    context: undefined,
    runAt: '2026-10-20T13:00:00.000Z',
  });
  assert.notEqual(defaultsId, id);

  await assert.rejects(
    repository.schedule({
      ...validInput,
      context: { fixture_reject: 'true' },
    }),
    (error) => error instanceof AppError && error.code === 'db_error'
  );

  console.log(
    'PostgreSQL automation pending-schedule integration SUCCESS: PostgreSQL 16, forced RLS, NOBYPASSRLS, column-only INSERT plus SELECT(id), generated IDs, optional/null fields, context default, transaction error mapping, and safe failure behavior.'
  );
} finally {
  await pool.end();
}
