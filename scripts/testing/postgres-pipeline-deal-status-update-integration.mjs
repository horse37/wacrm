import assert from 'node:assert/strict';
import { AppError } from '../../src/lib/db/errors.ts';
import { queryDb, withTransaction } from '../../src/lib/db/postgres-client.ts';
import { getPostgresPool } from '../../src/lib/db/postgres-pool.ts';
import { createPostgresPipelineDealStatusUpdateRepository } from '../../src/lib/repositories/pipeline-deal-status-update.ts';

const ownerA = '00000000-0000-4000-8000-000000000001';
const viewerA = '00000000-0000-4000-8000-000000000003';
const agentA = '00000000-0000-4000-8000-000000000005';
const dealA = '70000000-0000-4000-8000-000000000001';
const dealCrossPipelineCreator = '70000000-0000-4000-8000-000000000007';
const dealCrossDealCreator = '70000000-0000-4000-8000-000000000008';
const dealB = '70000000-0000-4000-8000-000000000006';
const pool = getPostgresPool();

function requireSuccess(result, label) {
  if (!result.ok) throw new Error(`${label} failed with ${result.error.code}`);
  return result.data;
}

async function expectAppError(promise, code) {
  await assert.rejects(
    promise,
    (error) => error instanceof AppError && error.code === code
  );
}

async function queryAs(userId, sql, values) {
  return withTransaction(async (transaction) => {
    await transaction.query(
      "SELECT set_config('request.jwt.claim.sub', $1, true)",
      [userId]
    );
    return transaction.query(sql, values);
  });
}

try {
  const runtime = requireSuccess(
    await queryDb(
      `SELECT current_user AS role,
              rolbypassrls,
              has_column_privilege(current_user, 'public.deals', 'status', 'UPDATE') AS can_change_status,
              has_column_privilege(current_user, 'public.deals', 'notes', 'UPDATE') AS can_edit_notes,
              has_column_privilege(current_user, 'public.deals', 'stage_id', 'UPDATE') AS can_move_stage
       FROM pg_roles
       WHERE rolname = current_user`
    ),
    'runtime role and update-column probe'
  );
  assert.deepEqual(runtime.rows, [
    {
      role: 'wacrm_pipeline_deal_status_update_runtime',
      rolbypassrls: false,
      can_change_status: true,
      can_edit_notes: false,
      can_move_stage: false,
    },
  ]);

  const ownerRepository = createPostgresPipelineDealStatusUpdateRepository(
    async () => ({ userId: ownerA })
  );
  const agentRepository = createPostgresPipelineDealStatusUpdateRepository(
    async () => ({ userId: agentA })
  );
  const viewerRepository = createPostgresPipelineDealStatusUpdateRepository(
    async () => ({ userId: viewerA })
  );

  const initial = requireSuccess(
    await queryAs(
      ownerA,
      'SELECT status, title, value::text AS value, notes, updated_at::text AS updated_at FROM public.deals WHERE id = $1',
      [dealA]
    ),
    'initial deal state'
  );
  assert.equal(initial.rows.length, 1);
  assert.equal(initial.rows[0].status, 'won');
  assert.equal(initial.rows[0].updated_at, '2026-10-19 11:00:00+00');

  await ownerRepository.setStatus(dealA, 'lost');
  let updated = requireSuccess(
    await queryAs(
      ownerA,
      'SELECT status, title, value::text AS value, notes, updated_at::text AS updated_at FROM public.deals WHERE id = $1',
      [dealA]
    ),
    'owner updated deal status'
  );
  assert.deepEqual(
    {
      status: updated.rows[0].status,
      title: updated.rows[0].title,
      value: updated.rows[0].value,
      notes: updated.rows[0].notes,
    },
    {
      status: 'lost',
      title: initial.rows[0].title,
      value: initial.rows[0].value,
      notes: initial.rows[0].notes,
    }
  );
  assert.notEqual(updated.rows[0].updated_at, initial.rows[0].updated_at);

  await agentRepository.setStatus(dealA, 'open');
  await ownerRepository.setStatus(dealA, 'won');
  updated = requireSuccess(
    await queryAs(ownerA, 'SELECT status FROM public.deals WHERE id = $1', [
      dealA,
    ]),
    'agent and owner status transitions'
  );
  assert.deepEqual(updated.rows, [{ status: 'won' }]);

  await expectAppError(viewerRepository.setStatus(dealA, 'lost'), 'forbidden');
  await expectAppError(ownerRepository.setStatus(dealB, 'lost'), 'not_found');
  await expectAppError(
    ownerRepository.setStatus(dealCrossPipelineCreator, 'lost'),
    'not_found'
  );
  await expectAppError(
    ownerRepository.setStatus(dealCrossDealCreator, 'lost'),
    'not_found'
  );
  await expectAppError(
    ownerRepository.setStatus('invalid', 'lost'),
    'bad_request'
  );
  await expectAppError(
    ownerRepository.setStatus(dealA, 'active'),
    'bad_request'
  );

  const noSessionRepository = createPostgresPipelineDealStatusUpdateRepository(
    async () => null
  );
  await expectAppError(
    noSessionRepository.setStatus(dealA, 'lost'),
    'unauthorized'
  );

  const pooledIdentity = requireSuccess(
    await queryDb('SELECT auth.uid()::text AS user_id'),
    'pooled identity reset probe'
  );
  assert.deepEqual(pooledIdentity.rows, [{ user_id: null }]);

  console.log(
    'PostgreSQL pipeline-deal-status-update integration SUCCESS: NOBYPASSRLS role, status-only column grant, owner/agent transitions, viewer denial, account/deal/pipeline-creator isolation, updated_at trigger, invalid-input rejection, fail-closed session, and transaction-local identity cleanup.'
  );
} finally {
  await pool.end();
}
