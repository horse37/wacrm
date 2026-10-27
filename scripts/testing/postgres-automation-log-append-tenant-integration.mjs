import assert from 'node:assert/strict';
import { AppError } from '../../src/lib/db/errors.ts';
import { queryDb, withTransaction } from '../../src/lib/db/postgres-client.ts';
import { getPostgresPool } from '../../src/lib/db/postgres-pool.ts';
import { createPostgresAutomationLogAppendRepository } from '../../src/lib/repositories/automation-log-append.ts';

const pool = getPostgresPool();
const repository = createPostgresAutomationLogAppendRepository();
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
const logId = '60000000-0000-4000-8000-000000000001';
const preserveId = '60000000-0000-4000-8000-000000000002';
const malformedId = '60000000-0000-4000-8000-000000000003';
const rollbackId = '60000000-0000-4000-8000-000000000004';
const crossTenantId = '60000000-0000-4000-8000-000000000005';
const sameTenantOtherOwnerId = '60000000-0000-4000-8000-000000000006';
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
      role: 'wacrm_automation_log_append_tenant_job',
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
    { column_name: 'steps_executed', privilege_type: 'SELECT' },
    { column_name: 'steps_executed', privilege_type: 'UPDATE' },
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
    await repository.append(
      writerA,
      logId,
      [firstStep, secondStep],
      'partial',
      'UPDATED_ERROR'
    ),
    true
  );
  assert.equal(
    await repository.append(writerA, crossTenantId, [firstStep]),
    false
  );
  assert.equal(
    await repository.append(writerA, sameTenantOtherOwnerId, [firstStep]),
    false,
    'agent must not append to another agent log in the same account'
  );
  const sameTenantOtherOwnerRow = await queryAs(
    writerA,
    `SELECT id, account_id, user_id, steps_executed, status, error_message
     FROM public.automation_logs
     WHERE id = $1 AND account_id = $2`,
    [sameTenantOtherOwnerId, writerA.accountId]
  );
  assert.deepEqual(sameTenantOtherOwnerRow.rows, [
    {
      id: sameTenantOtherOwnerId,
      account_id: writerA.accountId,
      user_id: '30000000-0000-4000-8000-000000000005',
      steps_executed: [],
      status: 'success',
      error_message: 'SAME_ACCOUNT_OTHER_OWNER_ORIGINAL_ERROR',
    },
  ]);
  await assertRlsDenies(
    writerA.userId,
    crossTenantId,
    'member of account A must not update account B row'
  );
  await assertRlsDenies(
    viewerA.userId,
    logId,
    'viewer must not update an automation log'
  );
  await assertRlsDenies(
    outsiderC.userId,
    logId,
    'member of account C must not update account A row'
  );

  const concurrentResults = await Promise.all([
    repository.append(writerA, logId, [
      {
        step_id: '50000000-0000-4000-8000-000000000003',
        step_type: 'wait',
        status: 'success',
      },
    ]),
    repository.append(writerA, logId, [
      {
        step_id: '50000000-0000-4000-8000-000000000004',
        step_type: 'condition',
        status: 'failed',
      },
    ]),
  ]);
  assert.deepEqual(concurrentResults, [true, true]);

  const persistedSteps = await queryAs(
    writerA,
    `SELECT steps_executed
     FROM public.automation_logs
     WHERE id = $1 AND account_id = $2 AND user_id = $3`,
    [logId, writerA.accountId, writerA.userId]
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
    await repository.append(writerA, preserveId, [secondStep], null, ''),
    true
  );
  assert.equal(
    await repository.append(writerA, malformedId, [firstStep]),
    false
  );
  assert.equal(
    await repository.append(writerB, logId, [firstStep]),
    false,
    'log ID from account A must not match account B writer context'
  );

  await assert.rejects(
    repository.append(
      writerA,
      rollbackId,
      [firstStep],
      'failed',
      'SYNTHETIC_REJECT'
    ),
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
    'PostgreSQL automation-log append tenant integration SUCCESS: PostgreSQL 16, test-only membership policy, forced RLS, NOBYPASSRLS, minimum column grants, same-account owner-scoped append, same-account other-owner denial, cross-account/viewer denial, ordered concurrent append, status/error preservation, safe constraint rollback, transaction-local identity cleanup.'
  );
} finally {
  await pool.end();
}
