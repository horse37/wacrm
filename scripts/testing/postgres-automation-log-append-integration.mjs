import assert from 'node:assert/strict';
import { AppError } from '../../src/lib/db/errors.ts';
import { queryDb } from '../../src/lib/db/postgres-client.ts';
import { getPostgresPool } from '../../src/lib/db/postgres-pool.ts';
import { createPostgresAutomationLogAppendRepository } from '../../src/lib/repositories/automation-log-append.ts';

const pool = getPostgresPool();
const repository = createPostgresAutomationLogAppendRepository();
const writer = {
  userId: '30000000-0000-4000-8000-000000000001',
  accountId: '20000000-0000-4000-8000-000000000001',
};
const logId = '60000000-0000-4000-8000-000000000001';
const preserveId = '60000000-0000-4000-8000-000000000002';
const malformedId = '60000000-0000-4000-8000-000000000003';
const rollbackId = '60000000-0000-4000-8000-000000000004';
const firstStep = {
  step_id: '50000000-0000-4000-8000-000000000001',
  step_type: 'send_message',
  status: 'success',
  detail: 'first append',
};
const secondStep = {
  step_id: '50000000-0000-4000-8000-000000000002',
  step_type: 'add_tag',
  status: 'skipped',
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
    { role: 'wacrm_automation_log_append_job', rolbypassrls: false },
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
    { column_name: 'account_id', privilege_type: 'SELECT' },
    { column_name: 'error_message', privilege_type: 'SELECT' },
    { column_name: 'error_message', privilege_type: 'UPDATE' },
    { column_name: 'id', privilege_type: 'SELECT' },
    { column_name: 'status', privilege_type: 'SELECT' },
    { column_name: 'status', privilege_type: 'UPDATE' },
    { column_name: 'steps_executed', privilege_type: 'SELECT' },
    { column_name: 'steps_executed', privilege_type: 'UPDATE' },
    { column_name: 'user_id', privilege_type: 'SELECT' },
  ]);

  const privileges = requireSuccess(
    await queryDb(
      `SELECT
         has_column_privilege(current_user, 'public.automation_logs', 'id', 'SELECT') AS select_id,
         has_column_privilege(current_user, 'public.automation_logs', 'account_id', 'SELECT') AS select_account,
         has_column_privilege(current_user, 'public.automation_logs', 'user_id', 'SELECT') AS select_user,
         has_column_privilege(current_user, 'public.automation_logs', 'steps_executed', 'SELECT') AS select_steps,
         has_column_privilege(current_user, 'public.automation_logs', 'status', 'SELECT') AS select_status,
         has_column_privilege(current_user, 'public.automation_logs', 'error_message', 'SELECT') AS select_error,
         has_column_privilege(current_user, 'public.automation_logs', 'error_message', 'UPDATE') AS update_error,
         has_column_privilege(current_user, 'public.automation_logs', 'private_payload', 'SELECT') AS select_private_payload,
         has_column_privilege(current_user, 'public.automation_logs', 'steps_executed', 'UPDATE') AS update_steps,
         has_table_privilege(current_user, 'public.automation_logs', 'INSERT') AS table_insert,
         has_table_privilege(current_user, 'public.automation_logs', 'DELETE') AS table_delete`
    ),
    'minimal privilege probe'
  );
  assert.deepEqual(privileges.rows, [
    {
      select_id: true,
      select_account: true,
      select_user: true,
      select_steps: true,
      select_status: true,
      select_error: true,
      update_error: true,
      select_private_payload: false,
      update_steps: true,
      table_insert: false,
      table_delete: false,
    },
  ]);

  assert.equal(
    await repository.append(
      writer,
      logId,
      [firstStep, secondStep],
      'partial',
      'UPDATED_ERROR'
    ),
    true
  );

  const concurrentResults = await Promise.all([
    repository.append(writer, logId, [
      {
        step_id: '50000000-0000-4000-8000-000000000003',
        step_type: 'wait',
        status: 'success',
      },
    ]),
    repository.append(writer, logId, [
      {
        step_id: '50000000-0000-4000-8000-000000000004',
        step_type: 'condition',
        status: 'failed',
      },
    ]),
  ]);
  assert.deepEqual(concurrentResults, [true, true]);

  const persistedSteps = requireSuccess(
    await queryDb(
      `SELECT steps_executed
       FROM public.automation_logs
       WHERE id = $1`,
      [logId]
    ),
    'persisted append read'
  );
  assert.deepEqual(persistedSteps.rows[0].steps_executed.slice(0, 3), [
    {
      step_id: '50000000-0000-4000-8000-000000000000',
      step_type: 'wait',
      status: 'success',
    },
    firstStep,
    secondStep,
  ]);
  assert.deepEqual(
    persistedSteps.rows[0].steps_executed
      .slice(3)
      .map((step) => step.step_id)
      .sort(),
    [
      '50000000-0000-4000-8000-000000000003',
      '50000000-0000-4000-8000-000000000004',
    ]
  );

  assert.equal(
    await repository.append(writer, preserveId, [secondStep], null, ''),
    true
  );
  assert.equal(
    await repository.append(writer, malformedId, [firstStep]),
    false
  );
  assert.equal(
    await repository.append(writer, '60000000-0000-4000-8000-000000000099', [
      firstStep,
    ]),
    false
  );

  await assert.rejects(
    repository.append(
      writer,
      rollbackId,
      [firstStep],
      'failed',
      'SYNTHETIC_REJECT'
    ),
    (error) => error instanceof AppError && error.code === 'db_error'
  );

  console.log(
    'PostgreSQL automation-log append integration SUCCESS: PostgreSQL 16, forced RLS, NOBYPASSRLS, minimum column grants, atomic ordered and concurrent appends, status/error preservation, malformed/missing-row no-op, safe constraint failure, and rollback.'
  );
} finally {
  await pool.end();
}
