import assert from 'node:assert/strict';
import { AppError } from '../../src/lib/db/errors.ts';
import { queryDb } from '../../src/lib/db/postgres-client.ts';
import { getPostgresPool } from '../../src/lib/db/postgres-pool.ts';
import { createPostgresAutomationPendingClaimRepository } from '../../src/lib/repositories/automation-pending-claim.ts';

const asOf = new Date('2026-10-20T12:00:00.000Z');
const concurrencyAsOf = new Date('2026-10-20T14:00:00.000Z');
const pool = getPostgresPool();
const repository = createPostgresAutomationPendingClaimRepository();
const writerA = {
  userId: '00000000-0000-4000-8000-000000000001',
  accountId: '10000000-0000-4000-8000-000000000001',
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
    { role: 'wacrm_automation_claim_job', rolbypassrls: false },
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

  const grants = requireSuccess(
    await queryDb(
      `SELECT table_name, privilege_type
       FROM information_schema.role_table_grants
       WHERE grantee = current_user
       ORDER BY table_name, privilege_type`
    ),
    'minimal table grant probe'
  );
  assert.deepEqual(grants.rows, [
    {
      table_name: 'automation_pending_executions',
      privilege_type: 'SELECT',
    },
  ]);
  const privilegeProbe = requireSuccess(
    await queryDb(
      `SELECT
         has_column_privilege(current_user, 'public.automation_pending_executions', 'status', 'UPDATE') AS can_update_status,
         has_table_privilege(current_user, 'public.automation_pending_executions', 'INSERT') AS can_insert,
         has_table_privilege(current_user, 'public.automation_pending_executions', 'DELETE') AS can_delete`
    ),
    'column grant probe'
  );
  assert.deepEqual(privilegeProbe.rows, [
    { can_update_status: true, can_insert: false, can_delete: false },
  ]);

  const firstBatch = await repository.claimDue(writerA, asOf, 4);
  assert.deepEqual(
    firstBatch.map((row) => row.id),
    [
      '40000000-0000-4000-8000-000000000001',
      '40000000-0000-4000-8000-000000000002',
      '40000000-0000-4000-8000-000000000003',
      '40000000-0000-4000-8000-000000000007',
    ]
  );
  assert.equal(firstBatch[0].contact_id, null);
  assert.deepEqual(Object.keys(firstBatch[1]).sort(), [
    'account_id',
    'automation_id',
    'branch',
    'contact_id',
    'context',
    'id',
    'log_id',
    'next_step_position',
    'parent_step_id',
    'user_id',
  ]);
  assert.equal(
    JSON.stringify(firstBatch).includes('SYNTHETIC_PRIVATE_PAYLOAD'),
    false
  );

  const inclusiveBoundary = await repository.claimDue(writerA, asOf, 1);
  assert.deepEqual(
    inclusiveBoundary.map((row) => row.id),
    ['40000000-0000-4000-8000-000000000004']
  );
  const excludedRows = requireSuccess(
    await queryDb(
      `SELECT id::text AS id, status
       FROM public.automation_pending_executions
       WHERE id IN (
         '40000000-0000-4000-8000-000000000005',
         '40000000-0000-4000-8000-000000000006'
       )
       ORDER BY id`
    ),
    'eligibility state probe'
  );
  assert.deepEqual(excludedRows.rows, [
    {
      id: '40000000-0000-4000-8000-000000000005',
      status: 'running',
    },
    {
      id: '40000000-0000-4000-8000-000000000006',
      status: 'pending',
    },
  ]);

  const holder = await pool.connect();
  try {
    await holder.query('BEGIN');
    const locked = await holder.query(
      `SELECT id
       FROM public.automation_pending_executions
       WHERE id = '40000000-0000-4000-8000-000000000101'
       FOR UPDATE`
    );
    assert.equal(locked.rowCount, 1);

    const skippedLock = await repository.claimDue(writerA, concurrencyAsOf, 1);
    assert.deepEqual(
      skippedLock.map((row) => row.id),
      ['40000000-0000-4000-8000-000000000102']
    );
  } finally {
    await holder.query('ROLLBACK');
    holder.release();
  }

  const releasedLock = await repository.claimDue(writerA, concurrencyAsOf, 1);
  assert.deepEqual(
    releasedLock.map((row) => row.id),
    ['40000000-0000-4000-8000-000000000101']
  );

  const concurrentClaims = await Promise.all([
    repository.claimDue(writerA, concurrencyAsOf, 4),
    repository.claimDue(writerA, concurrencyAsOf, 4),
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

  await assert.rejects(
    repository.claimDue(writerA, asOf, 51),
    (error) => error instanceof AppError && error.code === 'bad_request'
  );

  console.log(
    'PostgreSQL automation pending-claim integration SUCCESS: PostgreSQL 16, forced RLS, NOBYPASSRLS, SELECT plus status-only UPDATE, due/status eligibility, inclusive asOf boundary, stable order, safe projection, atomic claims, SKIP LOCKED, and disjoint concurrent batches.'
  );
} finally {
  await pool.end();
}
