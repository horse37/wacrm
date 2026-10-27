import assert from 'node:assert/strict';
import { AppError } from '../../src/lib/db/errors.ts';
import { queryDb } from '../../src/lib/db/postgres-client.ts';
import { getPostgresPool } from '../../src/lib/db/postgres-pool.ts';
import { createPostgresAutomationLogCreateRepository } from '../../src/lib/repositories/automation-log-create.ts';

const pool = getPostgresPool();
const repository = createPostgresAutomationLogCreateRepository();
const validInput = {
  automationId: '30000000-0000-4000-8000-000000000001',
  accountId: '10000000-0000-4000-8000-000000000001',
  userId: '00000000-0000-4000-8000-000000000001',
  contactId: '50000000-0000-4000-8000-000000000001',
  triggerEvent: 'new_message_received',
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
    { role: 'wacrm_automation_log_create_job', rolbypassrls: false },
  ]);

  const relation = requireSuccess(
    await queryDb(
      `SELECT relrowsecurity, relforcerowsecurity
       FROM pg_class
       WHERE oid = 'public.automation_logs'::regclass`
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
         AND table_name = 'automation_logs'
       ORDER BY column_name, privilege_type`
    ),
    'column-level grant probe'
  );
  assert.deepEqual(columnGrants.rows, [
    { column_name: 'account_id', privilege_type: 'INSERT' },
    { column_name: 'automation_id', privilege_type: 'INSERT' },
    { column_name: 'contact_id', privilege_type: 'INSERT' },
    { column_name: 'id', privilege_type: 'SELECT' },
    { column_name: 'status', privilege_type: 'INSERT' },
    { column_name: 'steps_executed', privilege_type: 'INSERT' },
    { column_name: 'trigger_event', privilege_type: 'INSERT' },
    { column_name: 'user_id', privilege_type: 'INSERT' },
  ]);

  const privileges = requireSuccess(
    await queryDb(
      `SELECT
         has_column_privilege(current_user, 'public.automation_logs', 'id', 'SELECT') AS select_id,
         has_column_privilege(current_user, 'public.automation_logs', 'private_payload', 'SELECT') AS select_private_payload,
         has_table_privilege(current_user, 'public.automation_logs', 'SELECT') AS table_select,
         has_table_privilege(current_user, 'public.automation_logs', 'INSERT') AS table_insert,
         has_table_privilege(current_user, 'public.automation_logs', 'UPDATE') AS table_update,
         has_table_privilege(current_user, 'public.automation_logs', 'DELETE') AS table_delete`
    ),
    'minimal privilege probe'
  );
  assert.deepEqual(privileges.rows, [
    {
      select_id: true,
      select_private_payload: false,
      table_select: false,
      table_insert: false,
      table_update: false,
      table_delete: false,
    },
  ]);

  const id = await repository.create(validInput);
  assert.match(
    id,
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
  );
  const visible = requireSuccess(
    await queryDb(
      `SELECT id::text AS id
       FROM public.automation_logs
       WHERE id = $1`,
      [id]
    ),
    'inserted log visibility'
  );
  assert.deepEqual(visible.rows, [{ id }]);

  const contactlessId = await repository.create({
    ...validInput,
    accountId: '10000000-0000-4000-8000-000000000003',
    contactId: null,
    triggerEvent: 'first_inbound_message',
  });
  assert.notEqual(contactlessId, id);

  await assert.rejects(
    repository.create({
      ...validInput,
      accountId: '10000000-0000-4000-8000-000000000002',
    }),
    (error) => error instanceof AppError && error.code === 'db_error'
  );

  console.log(
    'PostgreSQL automation-log creation integration SUCCESS: PostgreSQL 16, forced RLS, NOBYPASSRLS, column-only INSERT plus SELECT(id), generated UUID, contactless log, initial status/steps, and safe constraint-failure handling.'
  );
} finally {
  await pool.end();
}
