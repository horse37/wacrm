import assert from 'node:assert/strict';
import { AppError } from '../../src/lib/db/errors.ts';
import { queryDb } from '../../src/lib/db/postgres-client.ts';
import { getPostgresPool } from '../../src/lib/db/postgres-pool.ts';
import { createPostgresAutomationPendingFinalizeRepository } from '../../src/lib/repositories/automation-pending-finalize.ts';

const pool = getPostgresPool();
const repository = createPostgresAutomationPendingFinalizeRepository();
const ids = {
  done: '40000000-0000-4000-8000-000000000001',
  failed: '40000000-0000-4000-8000-000000000002',
  rejected: '40000000-0000-4000-8000-000000000003',
  pending: '40000000-0000-4000-8000-000000000004',
  alreadyDone: '40000000-0000-4000-8000-000000000005',
  missing: '40000000-0000-4000-8000-000000000099',
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
    { role: 'wacrm_automation_finalize_job', rolbypassrls: false },
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
    { column_name: 'id', privilege_type: 'SELECT' },
    { column_name: 'status', privilege_type: 'SELECT' },
    { column_name: 'status', privilege_type: 'UPDATE' },
  ]);

  const privileges = requireSuccess(
    await queryDb(
      `SELECT
         has_column_privilege(current_user, 'public.automation_pending_executions', 'id', 'SELECT') AS select_id,
         has_column_privilege(current_user, 'public.automation_pending_executions', 'status', 'SELECT') AS select_status,
         has_column_privilege(current_user, 'public.automation_pending_executions', 'status', 'UPDATE') AS update_status,
         has_table_privilege(current_user, 'public.automation_pending_executions', 'INSERT') AS table_insert,
         has_table_privilege(current_user, 'public.automation_pending_executions', 'DELETE') AS table_delete`
    ),
    'column privilege probe'
  );
  assert.deepEqual(privileges.rows, [
    {
      select_id: true,
      select_status: true,
      update_status: true,
      table_insert: false,
      table_delete: false,
    },
  ]);

  assert.equal(await repository.finalize(ids.done, 'done'), true);
  assert.equal(await repository.finalize(ids.failed, 'failed'), true);
  assert.equal(await repository.finalize(ids.done, 'failed'), false);
  assert.equal(await repository.finalize(ids.pending, 'done'), false);
  assert.equal(await repository.finalize(ids.alreadyDone, 'done'), false);
  assert.equal(await repository.finalize(ids.missing, 'failed'), false);
  await assert.rejects(
    repository.finalize(ids.rejected, 'failed'),
    (error) => error instanceof AppError && error.code === 'db_error'
  );

  console.log(
    'PostgreSQL automation pending-finalize integration SUCCESS: PostgreSQL 16, forced RLS, NOBYPASSRLS, minimum column-only grants, running-to-terminal transitions, no-op states, safe constraint failure.'
  );
} finally {
  await pool.end();
}
