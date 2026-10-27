import assert from 'node:assert/strict';
import { AppError } from '../../src/lib/db/errors.ts';
import { queryDb, withTransaction } from '../../src/lib/db/postgres-client.ts';
import { getPostgresPool } from '../../src/lib/db/postgres-pool.ts';
import { createPostgresAutomationLogCreateRepository } from '../../src/lib/repositories/automation-log-create.ts';

const pool = getPostgresPool();
const repository = createPostgresAutomationLogCreateRepository();
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
const otherOwnerA = '00000000-0000-4000-8000-000000000004';
const blockedAutomationId = '30000000-0000-4000-8000-000000000002';
const validInput = {
  automationId: '30000000-0000-4000-8000-000000000001',
  contactId: '50000000-0000-4000-8000-000000000001',
  triggerEvent: 'new_message_received',
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

async function assertRlsDeniesInsert(actorUserId, accountId, rowUserId, label) {
  const client = await pool.connect();
  let transactionOpen = false;
  try {
    await client.query('BEGIN');
    transactionOpen = true;
    await client.query("SELECT set_config('request.jwt.claim.sub', $1, true)", [
      actorUserId,
    ]);
    await assert.rejects(
      client.query(
        `INSERT INTO public.automation_logs
         (automation_id, account_id, user_id, contact_id, trigger_event, steps_executed, status)
         VALUES ($1, $2, $3, NULL, $4, '[]'::jsonb, 'success')
         RETURNING id`,
        [validInput.automationId, accountId, rowUserId, validInput.triggerEvent]
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
      role: 'wacrm_automation_log_create_tenant_job',
      rolbypassrls: false,
      rolsuper: false,
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
         has_function_privilege(current_user, 'public.wacrm_request_user_id()', 'EXECUTE') AS execute_user_id,
         has_function_privilege(current_user, 'public.is_account_member(uuid, public.account_role_enum)', 'EXECUTE') AS execute_membership,
         has_column_privilege(current_user, 'public.automation_logs', 'id', 'SELECT') AS select_id,
         has_column_privilege(current_user, 'public.automation_logs', 'private_payload', 'SELECT') AS select_private_payload,
         has_table_privilege(current_user, 'public.automation_logs', 'SELECT') AS table_select,
         has_table_privilege(current_user, 'public.automation_logs', 'INSERT') AS table_insert,
         has_table_privilege(current_user, 'public.automation_logs', 'UPDATE') AS table_update,
         has_table_privilege(current_user, 'public.automation_logs', 'DELETE') AS table_delete`
    ),
    'minimum privilege probe'
  );
  assert.deepEqual(privileges.rows, [
    {
      execute_user_id: true,
      execute_membership: true,
      select_id: true,
      select_private_payload: false,
      table_select: false,
      table_insert: false,
      table_update: false,
      table_delete: false,
    },
  ]);

  const ownerId = await repository.create(writerA, validInput);
  assert.match(
    ownerId,
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
  );
  const contactlessId = await repository.create(writerA, {
    ...validInput,
    contactId: null,
    triggerEvent: 'first_inbound_message',
  });
  const untrustedIdentityId = await repository.create(writerA, {
    ...validInput,
    accountId: writerB.accountId,
    userId: writerB.userId,
  });
  assert.notEqual(ownerId, contactlessId);
  assert.notEqual(ownerId, untrustedIdentityId);

  const visible = await queryAs(
    writerA,
    `SELECT id::text AS id
     FROM public.automation_logs
     WHERE id = ANY($1::uuid[])
     ORDER BY id`,
    [[ownerId, contactlessId, untrustedIdentityId]]
  );
  assert.equal(visible.rows.length, 3);

  await assertRlsDeniesInsert(
    writerA.userId,
    writerA.accountId,
    otherOwnerA,
    'account A agent cannot insert a row owned by another account A user'
  );
  await assertRlsDeniesInsert(
    writerA.userId,
    writerB.accountId,
    writerA.userId,
    'account A agent cannot insert into account B'
  );
  await assertRlsDeniesInsert(
    viewerA.userId,
    viewerA.accountId,
    viewerA.userId,
    'viewer cannot insert an automation log'
  );

  await assert.rejects(
    repository.create(viewerA, validInput),
    (error) => error instanceof AppError && error.code === 'db_error'
  );
  await assert.rejects(
    repository.create(writerA, {
      ...validInput,
      automationId: blockedAutomationId,
    }),
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
    'PostgreSQL automation-log creation tenant integration SUCCESS: PostgreSQL 16, test-only membership and owner policy, forced RLS, NOBYPASSRLS, minimum column grants, trusted owner insert, ignored payload identity fields, same-account other-owner/cross-account/viewer RLS denial, private-column protection, safe constraint rollback, and transaction-local identity cleanup.'
  );
} finally {
  await pool.end();
}
