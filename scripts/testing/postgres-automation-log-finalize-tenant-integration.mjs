import assert from 'node:assert/strict';
import { AppError } from '../../src/lib/db/errors.ts';
import { queryDb, withTransaction } from '../../src/lib/db/postgres-client.ts';
import { getPostgresPool } from '../../src/lib/db/postgres-pool.ts';
import { createPostgresAutomationLogFinalizeRepository } from '../../src/lib/repositories/automation-log-finalize.ts';

const pool = getPostgresPool();
const repository = createPostgresAutomationLogFinalizeRepository();
const writerA = {
  userId: '30000000-0000-4000-8000-000000000001',
  accountId: '20000000-0000-4000-8000-000000000001',
};
const writerB = {
  userId: '30000000-0000-4000-8000-000000000002',
  accountId: '20000000-0000-4000-8000-000000000002',
};
const viewerA = {
  userId: '30000000-0000-4000-8000-000000000004',
  accountId: '20000000-0000-4000-8000-000000000001',
};
const outsiderC = {
  userId: '30000000-0000-4000-8000-000000000003',
  accountId: '20000000-0000-4000-8000-000000000003',
};
const logId = '70000000-0000-4000-8000-000000000001';
const errorLogId = '70000000-0000-4000-8000-000000000002';
const rollbackId = '70000000-0000-4000-8000-000000000003';
const crossTenantId = '70000000-0000-4000-8000-000000000004';
const sameTenantOtherOwnerId = '70000000-0000-4000-8000-000000000005';

function requireSuccess(result, label) {
  if (!result.ok) throw new Error(`${label} failed with ${result.error.code}`);
  return result.data;
}

async function queryAs(writer, text, values = []) {
  const result = await withTransaction(async (transaction) => {
    await transaction.query(
      "SELECT set_config('request.jwt.claim.sub', $1, true)",
      [writer.userId]
    );
    return transaction.query(text, values);
  });
  return requireSuccess(result, 'scoped read');
}

async function assertRlsDenies(userId, targetLogId, label) {
  const client = await pool.connect();
  let transactionOpen = false;
  try {
    await client.query('BEGIN');
    transactionOpen = true;
    await client.query("SELECT set_config('request.jwt.claim.sub', $1, true)", [
      userId,
    ]);
    const result = await client.query(
      `UPDATE public.automation_logs
       SET status = 'failed'
       WHERE id = $1
       RETURNING id`,
      [targetLogId]
    );
    assert.equal(result.rowCount, 0, label);
    await client.query('ROLLBACK');
    transactionOpen = false;
  } finally {
    if (transactionOpen) await client.query('ROLLBACK');
    client.release();
  }
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
    {
      role: 'wacrm_automation_log_finalize_tenant_job',
      rolbypassrls: false,
    },
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
    { column_name: 'user_id', privilege_type: 'SELECT' },
  ]);

  const privileges = requireSuccess(
    await queryDb(
      `SELECT
         has_function_privilege(current_user, 'public.is_account_member(uuid, public.account_role_enum)', 'EXECUTE') AS execute_membership,
         has_column_privilege(current_user, 'public.automation_logs', 'id', 'SELECT') AS select_id,
         has_column_privilege(current_user, 'public.automation_logs', 'account_id', 'SELECT') AS select_account,
         has_column_privilege(current_user, 'public.automation_logs', 'user_id', 'SELECT') AS select_user,
         has_column_privilege(current_user, 'public.automation_logs', 'private_payload', 'SELECT') AS select_private_payload,
         has_column_privilege(current_user, 'public.automation_logs', 'account_id', 'UPDATE') AS update_account,
         has_column_privilege(current_user, 'public.automation_logs', 'private_payload', 'UPDATE') AS update_private_payload,
         has_table_privilege(current_user, 'public.automation_logs', 'INSERT') AS table_insert,
         has_table_privilege(current_user, 'public.automation_logs', 'DELETE') AS table_delete`
    ),
    'minimum privilege probe'
  );
  assert.deepEqual(privileges.rows, [
    {
      execute_membership: true,
      select_id: true,
      select_account: true,
      select_user: true,
      select_private_payload: false,
      update_account: false,
      update_private_payload: false,
      table_insert: false,
      table_delete: false,
    },
  ]);

  assert.equal(
    await repository.finalize(writerA, logId, 'partial', null),
    true
  );
  assert.equal(
    await repository.finalize(writerA, errorLogId, 'failed', 'FINALIZED_ERROR'),
    true
  );
  assert.equal(
    await repository.finalize(writerA, crossTenantId, 'failed', 'CROSS_ERROR'),
    false
  );
  await assertRlsDenies(
    writerA.userId,
    crossTenantId,
    'account A member must not finalize account B row'
  );
  assert.equal(
    await repository.finalize(
      writerA,
      sameTenantOtherOwnerId,
      'failed',
      'OTHER_OWNER_ERROR'
    ),
    false,
    'agent must not finalize another agent log in the same account'
  );
  const sameTenantOtherOwnerRow = await queryAs(
    writerA,
    `SELECT id, account_id, user_id, status, error_message
     FROM public.automation_logs
     WHERE id = $1 AND account_id = $2`,
    [sameTenantOtherOwnerId, writerA.accountId]
  );
  assert.deepEqual(sameTenantOtherOwnerRow.rows, [
    {
      id: sameTenantOtherOwnerId,
      account_id: writerA.accountId,
      user_id: '30000000-0000-4000-8000-000000000005',
      status: 'success',
      error_message: 'SAME_ACCOUNT_OTHER_OWNER_ORIGINAL_ERROR',
    },
  ]);
  await assertRlsDenies(
    viewerA.userId,
    logId,
    'viewer must not finalize an automation log'
  );
  await assertRlsDenies(
    outsiderC.userId,
    logId,
    'member of account C must not finalize account A row'
  );
  assert.equal(
    await repository.finalize(writerB, logId, 'failed', 'WRONG_OWNER_ERROR'),
    false,
    'account B context must not finalize account A log'
  );

  await assert.rejects(
    repository.finalize(writerA, rollbackId, 'failed', 'SYNTHETIC_REJECT'),
    (error) => error instanceof AppError && error.code === 'db_error'
  );

  const identityAfterCommit = requireSuccess(
    await queryDb(
      `SELECT current_setting('request.jwt.claim.sub', true) AS claim`
    ),
    'transaction-local identity cleanup probe'
  );
  assert.ok(
    identityAfterCommit.rows[0].claim === null ||
      identityAfterCommit.rows[0].claim === '',
    'request identity must not leak after transaction'
  );

  console.log(
    'PostgreSQL automation-log finalize tenant integration SUCCESS: PostgreSQL 16, test-only membership policy, forced RLS, NOBYPASSRLS, minimum column grants, same-account owner finalize, same-account other-owner denial, cross-account/viewer denial, status/error set and clear, safe constraint rollback, transaction-local identity cleanup.'
  );
} finally {
  await pool.end();
}
