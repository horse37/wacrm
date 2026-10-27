import assert from 'node:assert/strict';
import { AppError } from '../../src/lib/db/errors.ts';
import { queryDb, withTransaction } from '../../src/lib/db/postgres-client.ts';
import { getPostgresPool } from '../../src/lib/db/postgres-pool.ts';
import { createPostgresAutomationPendingScheduleRepository } from '../../src/lib/repositories/automation-pending-schedule.ts';

const pool = getPostgresPool();
const repository = createPostgresAutomationPendingScheduleRepository();
const writerA = {
  userId: '00000000-0000-4000-8000-000000000001',
  accountId: '10000000-0000-4000-8000-000000000001',
};
const writerB = {
  userId: '00000000-0000-4000-8000-000000000002',
  accountId: '10000000-0000-4000-8000-000000000002',
};
const viewerA = {
  userId: '00000000-0000-4000-8000-000000000003',
  accountId: '10000000-0000-4000-8000-000000000001',
};
const otherOwnerA = {
  userId: '00000000-0000-4000-8000-000000000004',
  accountId: '10000000-0000-4000-8000-000000000001',
};
const validInput = {
  automationId: '30000000-0000-4000-8000-000000000001',
  contactId: '50000000-0000-4000-8000-000000000001',
  logId: '60000000-0000-4000-8000-000000000001',
  parentStepId: '70000000-0000-4000-8000-000000000001',
  branch: 'yes',
  nextStepPosition: 4,
  context: {
    message_text: 'Synthetic tenant fixture',
    vars: { source: 'docker' },
  },
  runAt: new Date('2026-10-20T12:00:00.000Z'),
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

async function assertRlsDeniesInsert(writer, automationId, label) {
  const client = await pool.connect();
  let transactionOpen = false;
  try {
    await client.query('BEGIN');
    transactionOpen = true;
    await client.query("SELECT set_config('request.jwt.claim.sub', $1, true)", [
      writer.userId,
    ]);
    await assert.rejects(
      client.query(
        `INSERT INTO public.automation_pending_executions
         (automation_id, account_id, user_id, contact_id, log_id, parent_step_id,
          branch, next_step_position, context, run_at, status)
         VALUES ($1, $2, $3, NULL, NULL, NULL, NULL, 0, '{}'::jsonb, now(), 'pending')
         RETURNING id`,
        [automationId, writer.accountId, writer.userId]
      ),
      (error) => error.code === '42501',
      label
    );
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
    'PG version'
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
      role: 'wacrm_automation_pending_schedule_tenant_job',
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

  const privileges = requireSuccess(
    await queryDb(
      `SELECT
         has_function_privilege(current_user, 'public.wacrm_request_user_id()', 'EXECUTE') AS execute_user_id,
         has_function_privilege(current_user, 'public.is_account_member(uuid, public.account_role_enum)', 'EXECUTE') AS execute_membership,
         has_function_privilege(current_user, 'public.is_automation_writer(uuid, uuid)', 'EXECUTE') AS execute_automation_writer,
         has_column_privilege(current_user, 'public.automation_pending_executions', 'id', 'SELECT') AS select_id,
         has_column_privilege(current_user, 'public.automation_pending_executions', 'private_payload', 'SELECT') AS select_private_payload,
         has_table_privilege(current_user, 'public.automation_pending_executions', 'SELECT') AS table_select,
         has_table_privilege(current_user, 'public.automation_pending_executions', 'INSERT') AS table_insert,
         has_table_privilege(current_user, 'public.automation_pending_executions', 'UPDATE') AS table_update,
         has_table_privilege(current_user, 'public.automation_pending_executions', 'DELETE') AS table_delete`
    ),
    'minimum privilege probe'
  );
  assert.deepEqual(privileges.rows, [
    {
      execute_user_id: true,
      execute_membership: true,
      execute_automation_writer: true,
      select_id: true,
      select_private_payload: false,
      table_select: false,
      table_insert: false,
      table_update: false,
      table_delete: false,
    },
  ]);

  const ownerId = await repository.schedule(writerA, validInput);
  assert.match(
    ownerId,
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
  );
  const defaultsId = await repository.schedule(writerA, {
    ...validInput,
    contactId: null,
    logId: null,
    parentStepId: null,
    branch: null,
    context: undefined,
    runAt: '2026-10-20T13:00:00.000Z',
  });
  const forgedIdentityId = await repository.schedule(writerA, {
    ...validInput,
    accountId: writerB.accountId,
    userId: writerB.userId,
  });
  assert.notEqual(ownerId, defaultsId);
  assert.notEqual(ownerId, forgedIdentityId);

  const visible = await queryAs(
    writerA,
    `SELECT id::text AS id
     FROM public.automation_pending_executions
     WHERE id = ANY($1::uuid[])
     ORDER BY id`,
    [[ownerId, defaultsId, forgedIdentityId]]
  );
  assert.equal(visible.rows.length, 3);

  await assertRlsDeniesInsert(
    otherOwnerA,
    validInput.automationId,
    'same-account agent cannot schedule for an automation owned by another user'
  );
  await assertRlsDeniesInsert(
    writerB,
    validInput.automationId,
    'account B owner cannot schedule an account A automation'
  );
  await assertRlsDeniesInsert(
    viewerA,
    validInput.automationId,
    'viewer cannot schedule an automation execution'
  );

  await assert.rejects(
    repository.schedule(writerA, {
      ...validInput,
      context: { fixture_reject: 'true' },
    }),
    (error) => error instanceof AppError && error.code === 'db_error'
  );

  const identityAfterCommit = requireSuccess(
    await queryDb(
      "SELECT current_setting('request.jwt.claim.sub', true) AS claim"
    ),
    'transaction-local identity cleanup probe'
  );
  assert.ok(
    identityAfterCommit.rows[0].claim === null ||
      identityAfterCommit.rows[0].claim === '',
    'request identity must not leak after transaction'
  );

  console.log(
    'PostgreSQL pending-schedule tenant integration SUCCESS: PostgreSQL 16, test-only account/automation ownership policies, forced RLS, NOBYPASSRLS, minimum column grants, trusted owner inserts, ignored payload identity fields, same-account other-owner/cross-account/viewer RLS denials, private-column protection, safe constraint rollback, and transaction-local identity cleanup.'
  );
} finally {
  await pool.end();
}
