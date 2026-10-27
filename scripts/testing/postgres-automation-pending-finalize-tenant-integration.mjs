import assert from 'node:assert/strict';
import { AppError } from '../../src/lib/db/errors.ts';
import { queryDb, withTransaction } from '../../src/lib/db/postgres-client.ts';
import { getPostgresPool } from '../../src/lib/db/postgres-pool.ts';
import { createPostgresAutomationPendingFinalizeRepository } from '../../src/lib/repositories/automation-pending-finalize.ts';

const pool = getPostgresPool();
const repository = createPostgresAutomationPendingFinalizeRepository();
const writerA = {
  userId: '30000000-0000-4000-8000-000000000001',
  accountId: '10000000-0000-4000-8000-000000000001',
};
const outsiderC = {
  userId: '30000000-0000-4000-8000-000000000003',
  accountId: '10000000-0000-4000-8000-000000000003',
};
const viewerA = {
  userId: '30000000-0000-4000-8000-000000000004',
  accountId: '10000000-0000-4000-8000-000000000001',
};
const ids = {
  done: '40000000-0000-4000-8000-000000000001',
  failed: '40000000-0000-4000-8000-000000000002',
  rollback: '40000000-0000-4000-8000-000000000003',
  crossTenant: '40000000-0000-4000-8000-000000000004',
  otherOwner: '40000000-0000-4000-8000-000000000005',
  viewer: '40000000-0000-4000-8000-000000000006',
  missing: '40000000-0000-4000-8000-000000000099',
};

function requireSuccess(result, label) {
  if (!result.ok) throw new Error(`${label} failed with ${result.error.code}`);
  return result.data;
}

async function readAs(writer, id) {
  const result = await withTransaction(async (transaction) => {
    await transaction.query(
      "SELECT set_config('request.jwt.claim.sub', $1, true)",
      [writer.userId]
    );
    return transaction.query(
      `SELECT id::text AS id, account_id::text AS account_id,
              user_id::text AS user_id, status
       FROM public.automation_pending_executions
       WHERE id = $1`,
      [id]
    );
  });
  return requireSuccess(result, 'tenant-scoped row read').rows;
}

async function assertViewerRlsDenial() {
  const client = await pool.connect();
  let transactionOpen = false;
  try {
    await client.query('BEGIN');
    transactionOpen = true;
    await client.query("SELECT set_config('request.jwt.claim.sub', $1, true)", [
      viewerA.userId,
    ]);
    const result = await client.query(
      `UPDATE public.automation_pending_executions
       SET status = 'done'
       WHERE id = $1
       RETURNING id`,
      [ids.viewer]
    );
    assert.equal(result.rowCount, 0, 'viewer policy must hide UPDATE row');
    await client.query('ROLLBACK');
    transactionOpen = false;
  } finally {
    if (transactionOpen) await client.query('ROLLBACK');
    client.release();
  }
}

try {
  const version = requireSuccess(
    await queryDb('SHOW server_version_num'),
    'PostgreSQL version probe'
  );
  assert.match(version.rows[0].server_version_num, /^16/);

  const runtime = requireSuccess(
    await queryDb(
      `SELECT current_user AS role, rolbypassrls, rolsuper
       FROM pg_roles WHERE rolname = current_user`
    ),
    'runtime role probe'
  );
  assert.deepEqual(runtime.rows, [
    {
      role: 'wacrm_automation_pending_finalize_tenant_job',
      rolbypassrls: false,
      rolsuper: false,
    },
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
    { column_name: 'account_id', privilege_type: 'SELECT' },
    { column_name: 'id', privilege_type: 'SELECT' },
    { column_name: 'status', privilege_type: 'SELECT' },
    { column_name: 'status', privilege_type: 'UPDATE' },
    { column_name: 'user_id', privilege_type: 'SELECT' },
  ]);

  const privileges = requireSuccess(
    await queryDb(
      `SELECT
         has_function_privilege(current_user, 'public.wacrm_request_user_id()', 'EXECUTE') AS execute_user_id,
         has_function_privilege(current_user, 'public.is_account_member(uuid, public.account_role_enum)', 'EXECUTE') AS execute_membership,
         has_column_privilege(current_user, 'public.automation_pending_executions', 'id', 'SELECT') AS select_id,
         has_column_privilege(current_user, 'public.automation_pending_executions', 'account_id', 'SELECT') AS select_account,
         has_column_privilege(current_user, 'public.automation_pending_executions', 'user_id', 'SELECT') AS select_user,
         has_column_privilege(current_user, 'public.automation_pending_executions', 'status', 'SELECT') AS select_status,
         has_column_privilege(current_user, 'public.automation_pending_executions', 'status', 'UPDATE') AS update_status,
         has_column_privilege(current_user, 'public.automation_pending_executions', 'private_payload', 'SELECT') AS select_private,
         has_table_privilege(current_user, 'public.automation_pending_executions', 'UPDATE') AS table_update,
         has_table_privilege(current_user, 'public.automation_pending_executions', 'DELETE') AS table_delete`
    ),
    'minimum privilege probe'
  );
  assert.deepEqual(privileges.rows, [
    {
      execute_user_id: false,
      execute_membership: true,
      select_id: true,
      select_account: true,
      select_user: true,
      select_status: true,
      update_status: true,
      select_private: false,
      table_update: false,
      table_delete: false,
    },
  ]);

  assert.equal(await repository.finalize(writerA, ids.done, 'done'), true);
  assert.equal(await repository.finalize(writerA, ids.failed, 'failed'), true);
  assert.equal(await repository.finalize(writerA, ids.done, 'failed'), false);
  assert.equal(
    await repository.finalize(writerA, ids.missing, 'failed'),
    false
  );
  assert.equal(
    await repository.finalize(writerA, ids.crossTenant, 'done'),
    false
  );
  assert.equal(
    await repository.finalize(writerA, ids.otherOwner, 'done'),
    false
  );
  assert.equal(await repository.finalize(viewerA, ids.viewer, 'done'), false);

  await assert.rejects(
    repository.finalize(writerA, ids.rollback, 'failed'),
    (error) => error instanceof AppError && error.code === 'db_error'
  );
  await assertViewerRlsDenial();

  assert.deepEqual(await readAs(writerA, ids.done), [
    {
      id: ids.done,
      account_id: writerA.accountId,
      user_id: writerA.userId,
      status: 'done',
    },
  ]);
  assert.deepEqual(await readAs(writerA, ids.failed), [
    {
      id: ids.failed,
      account_id: writerA.accountId,
      user_id: writerA.userId,
      status: 'failed',
    },
  ]);
  assert.equal((await readAs(writerA, ids.crossTenant)).length, 0);
  assert.equal((await readAs(writerA, ids.otherOwner)).length, 1);
  assert.equal((await readAs(outsiderC, ids.otherOwner)).length, 0);

  const identity = requireSuccess(
    await queryDb(
      `SELECT NULLIF(current_setting('request.jwt.claim.sub', true), '') AS actor`
    ),
    'transaction-local identity cleanup probe'
  );
  assert.equal(identity.rows[0].actor, null);

  console.log(
    'PostgreSQL pending-finalize tenant integration SUCCESS: PostgreSQL 16, forced RLS, NOBYPASSRLS, minimum column grants, owner-scoped terminal updates, denials/no-ops, safe rollback, identity cleanup.'
  );
} finally {
  await pool.end();
}
