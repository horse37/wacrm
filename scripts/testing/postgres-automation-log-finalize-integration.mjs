import assert from 'node:assert/strict';
import { AppError } from '../../src/lib/db/errors.ts';
import { queryDb } from '../../src/lib/db/postgres-client.ts';
import { getPostgresPool } from '../../src/lib/db/postgres-pool.ts';
import { createPostgresAutomationLogFinalizeRepository } from '../../src/lib/repositories/automation-log-finalize.ts';

const pool = getPostgresPool();
const repository = createPostgresAutomationLogFinalizeRepository();
const successId = '70000000-0000-4000-8000-000000000001';
const failureId = '70000000-0000-4000-8000-000000000002';
const partialId = '70000000-0000-4000-8000-000000000003';
const rollbackId = '70000000-0000-4000-8000-000000000004';

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
    { role: 'wacrm_automation_log_finalize_job', rolbypassrls: false },
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
    { column_name: 'error_message', privilege_type: 'UPDATE' },
    { column_name: 'id', privilege_type: 'SELECT' },
    { column_name: 'status', privilege_type: 'UPDATE' },
  ]);

  const privileges = requireSuccess(
    await queryDb(
      `SELECT
         has_column_privilege(current_user, 'public.automation_logs', 'id', 'SELECT') AS select_id,
         has_column_privilege(current_user, 'public.automation_logs', 'status', 'SELECT') AS select_status,
         has_column_privilege(current_user, 'public.automation_logs', 'status', 'UPDATE') AS update_status,
         has_column_privilege(current_user, 'public.automation_logs', 'error_message', 'UPDATE') AS update_error,
         has_column_privilege(current_user, 'public.automation_logs', 'private_payload', 'SELECT') AS select_private_payload,
         has_column_privilege(current_user, 'public.automation_logs', 'private_payload', 'UPDATE') AS update_private_payload,
         has_table_privilege(current_user, 'public.automation_logs', 'INSERT') AS table_insert,
         has_table_privilege(current_user, 'public.automation_logs', 'DELETE') AS table_delete`
    ),
    'minimal privilege probe'
  );
  assert.deepEqual(privileges.rows, [
    {
      select_id: true,
      select_status: false,
      update_status: true,
      update_error: true,
      select_private_payload: false,
      update_private_payload: false,
      table_insert: false,
      table_delete: false,
    },
  ]);

  assert.equal(await repository.finalize(successId, 'success', null), true);
  assert.equal(
    await repository.finalize(failureId, 'failed', 'new synthetic failure'),
    true
  );
  assert.equal(await repository.finalize(partialId, 'partial', ''), true);
  assert.equal(
    await repository.finalize(
      '70000000-0000-4000-8000-000000000099',
      'success',
      null
    ),
    false
  );

  await assert.rejects(
    repository.finalize(rollbackId, 'failed', 'SYNTHETIC_REJECT'),
    (error) => error instanceof AppError && error.code === 'db_error'
  );

  console.log(
    'PostgreSQL automation-log finalization integration SUCCESS: PostgreSQL 16, forced RLS, NOBYPASSRLS, column-only grants, success/failure/partial status, explicit error set/clear, missing-row no-op, safe constraint failure, and rollback.'
  );
} finally {
  await pool.end();
}
