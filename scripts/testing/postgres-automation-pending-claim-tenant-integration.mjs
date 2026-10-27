import assert from 'node:assert/strict';
import { queryDb } from '../../src/lib/db/postgres-client.ts';
import { getPostgresPool } from '../../src/lib/db/postgres-pool.ts';
import { createPostgresAutomationPendingClaimRepository } from '../../src/lib/repositories/automation-pending-claim.ts';

const asOf = new Date('2026-10-20T14:00:00.000Z');
const pool = getPostgresPool();
const repository = createPostgresAutomationPendingClaimRepository();
const accountA = '10000000-0000-4000-8000-000000000001';
const accountB = '10000000-0000-4000-8000-000000000002';
const writerA = {
  userId: '30000000-0000-4000-8000-000000000003',
  accountId: accountA,
};
const writerB = {
  userId: '30000000-0000-4000-8000-000000000006',
  accountId: accountB,
};
const viewerA = {
  userId: '30000000-0000-4000-8000-000000000004',
  accountId: accountA,
};
const nonmemberA = {
  userId: '30000000-0000-4000-8000-000000000007',
  accountId: accountA,
};

function requireSuccess(result, label) {
  if (!result.ok) throw new Error(`${label} failed with ${result.error.code}`);
  return result.data;
}

try {
  const version = requireSuccess(
    await queryDb('SHOW server_version_num'),
    'PostgreSQL version probe'
  );
  assert.match(version.rows[0].server_version_num, /^16/);

  const role = requireSuccess(
    await queryDb(
      `SELECT current_user AS role, rolbypassrls
       FROM pg_roles WHERE rolname = current_user`
    ),
    'runtime role probe'
  );
  assert.deepEqual(role.rows, [
    {
      role: 'wacrm_automation_pending_claim_tenant_job',
      rolbypassrls: false,
    },
  ]);

  const rls = requireSuccess(
    await queryDb(
      `SELECT relrowsecurity, relforcerowsecurity
       FROM pg_class
       WHERE oid = 'public.automation_pending_executions'::regclass`
    ),
    'forced RLS probe'
  );
  assert.deepEqual(rls.rows, [
    { relrowsecurity: true, relforcerowsecurity: true },
  ]);

  const grants = requireSuccess(
    await queryDb(
      `SELECT column_name, privilege_type
       FROM information_schema.column_privileges
       WHERE grantee = current_user
         AND table_schema = 'public'
         AND table_name = 'automation_pending_executions'
       ORDER BY column_name, privilege_type`
    ),
    'column grant probe'
  );
  assert.deepEqual(
    grants.rows,
    [
      ...[
        'account_id',
        'automation_id',
        'branch',
        'contact_id',
        'context',
        'id',
        'log_id',
        'next_step_position',
        'parent_step_id',
        'run_at',
        'status',
        'user_id',
      ].map((column_name) => ({ column_name, privilege_type: 'SELECT' })),
      { column_name: 'status', privilege_type: 'UPDATE' },
    ].sort((left, right) =>
      `${left.column_name}:${left.privilege_type}`.localeCompare(
        `${right.column_name}:${right.privilege_type}`
      )
    )
  );

  const privileges = requireSuccess(
    await queryDb(
      `SELECT
         has_column_privilege(current_user, 'public.automation_pending_executions', 'private_payload', 'SELECT') AS select_private,
         has_column_privilege(current_user, 'public.automation_pending_executions', 'status', 'UPDATE') AS update_status,
         has_table_privilege(current_user, 'public.automation_pending_executions', 'INSERT') AS insert_rows,
         has_table_privilege(current_user, 'public.automation_pending_executions', 'DELETE') AS delete_rows`
    ),
    'least privilege probe'
  );
  assert.deepEqual(privileges.rows, [
    {
      select_private: false,
      update_status: true,
      insert_rows: false,
      delete_rows: false,
    },
  ]);

  const deniedViewer = await repository.claimDue(viewerA, asOf);
  assert.deepEqual(deniedViewer, []);

  const deniedNonmember = await repository.claimDue(nonmemberA, asOf);
  assert.deepEqual(deniedNonmember, []);

  const claimedA = await repository.claimDue(writerA, asOf, 4);
  assert.deepEqual(
    claimedA.map((row) => row.id),
    [
      '40000000-0000-4000-8000-000000000001',
      '40000000-0000-4000-8000-000000000002',
      '40000000-0000-4000-8000-000000000004',
      '40000000-0000-4000-8000-000000000005',
    ]
  );
  assert.deepEqual(
    claimedA.map((row) => row.user_id),
    [
      '30000000-0000-4000-8000-000000000001',
      '30000000-0000-4000-8000-000000000002',
      '30000000-0000-4000-8000-000000000001',
      '30000000-0000-4000-8000-000000000002',
    ]
  );
  assert.ok(claimedA.every((row) => row.account_id === accountA));

  const identityCleanup = requireSuccess(
    await queryDb(
      `SELECT NULLIF(current_setting('request.jwt.claim.sub', true), '') AS actor_id`
    ),
    'transaction-local identity cleanup'
  );
  assert.deepEqual(identityCleanup.rows, [{ actor_id: null }]);

  const privateRead = await queryDb(
    `SELECT private_payload
     FROM public.automation_pending_executions
     WHERE id = $1`,
    ['40000000-0000-4000-8000-000000000001']
  );
  assert.equal(privateRead.ok, false);

  const claimedB = await repository.claimDue(writerB, asOf, 4);
  assert.deepEqual(
    claimedB.map((row) => row.id),
    ['40000000-0000-4000-8000-000000000003']
  );
  assert.equal(claimedB[0].account_id, accountB);

  const holder = await pool.connect();
  try {
    await holder.query('BEGIN');
    await holder.query("SELECT set_config('request.jwt.claim.sub', $1, true)", [
      writerA.userId,
    ]);
    const locked = await holder.query(
      `SELECT id
       FROM public.automation_pending_executions
       WHERE id = '40000000-0000-4000-8000-000000000101'
       FOR UPDATE`
    );
    assert.equal(locked.rowCount, 1);

    const skippedLock = await repository.claimDue(writerA, asOf, 1);
    assert.deepEqual(
      skippedLock.map((row) => row.id),
      ['40000000-0000-4000-8000-000000000102']
    );
  } finally {
    await holder.query('ROLLBACK');
    holder.release();
  }

  const releasedLock = await repository.claimDue(writerA, asOf, 1);
  assert.deepEqual(
    releasedLock.map((row) => row.id),
    ['40000000-0000-4000-8000-000000000101']
  );

  const concurrentClaims = await Promise.all([
    repository.claimDue(writerA, asOf, 4),
    repository.claimDue(writerA, asOf, 4),
  ]);
  const concurrentIds = concurrentClaims.flat().map((row) => row.id);
  assert.equal(concurrentIds.length, 8);
  assert.equal(new Set(concurrentIds).size, 8);
  assert.deepEqual(
    [...concurrentIds].sort(),
    Array.from(
      { length: 8 },
      (_, index) =>
        `40000000-0000-4000-8000-${String(index + 103).padStart(12, '0')}`
    ).sort()
  );

  console.log(
    'PostgreSQL automation pending-claim tenant integration SUCCESS: PostgreSQL 16, forced RLS, minimum column grants, cross-account isolation, viewer/nonmember denial, multi-owner projection, transaction-local identity cleanup, private-column denial, SKIP LOCKED, and disjoint concurrent batches.'
  );
} finally {
  await pool.end();
}
