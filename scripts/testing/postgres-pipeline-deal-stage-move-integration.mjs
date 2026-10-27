import assert from 'node:assert/strict';
import { AppError } from '../../src/lib/db/errors.ts';
import { queryDb, withTransaction } from '../../src/lib/db/postgres-client.ts';
import { getPostgresPool } from '../../src/lib/db/postgres-pool.ts';
import { createPostgresPipelineDealStageMoveRepository } from '../../src/lib/repositories/pipeline-deal-stage-move.ts';

const ownerA = '00000000-0000-4000-8000-000000000001';
const viewerA = '00000000-0000-4000-8000-000000000003';
const agentA = '00000000-0000-4000-8000-000000000005';
const dealA = '70000000-0000-4000-8000-000000000001';
const dealCrossPipelineCreator = '70000000-0000-4000-8000-000000000007';
const dealCrossDealCreator = '70000000-0000-4000-8000-000000000008';
const dealB = '70000000-0000-4000-8000-000000000006';
const stageA = '60000000-0000-4000-8000-000000000001';
const stageATarget = '60000000-0000-4000-8000-000000000006';
const stageAOtherPipeline = '60000000-0000-4000-8000-000000000003';
const stageB = '60000000-0000-4000-8000-000000000002';
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
              has_column_privilege(current_user, 'public.deals', 'stage_id', 'UPDATE') AS can_move,
              has_column_privilege(current_user, 'public.deals', 'notes', 'UPDATE') AS can_edit_notes
       FROM pg_roles
       WHERE rolname = current_user`
    ),
    'runtime role and update-column probe'
  );
  assert.deepEqual(runtime.rows, [
    {
      role: 'wacrm_pipeline_deal_stage_move_runtime',
      rolbypassrls: false,
      can_move: true,
      can_edit_notes: false,
    },
  ]);

  const ownerRepository = createPostgresPipelineDealStageMoveRepository(
    async () => ({ userId: ownerA })
  );
  const agentRepository = createPostgresPipelineDealStageMoveRepository(
    async () => ({ userId: agentA })
  );
  const viewerRepository = createPostgresPipelineDealStageMoveRepository(
    async () => ({ userId: viewerA })
  );

  const initial = requireSuccess(
    await queryAs(
      ownerA,
      'SELECT stage_id::text AS stage_id, updated_at::text AS updated_at FROM public.deals WHERE id = $1',
      [dealA]
    ),
    'initial deal state'
  );
  assert.deepEqual(initial.rows, [
    { stage_id: stageA, updated_at: '2026-10-19 11:00:00+00' },
  ]);

  await ownerRepository.moveToStage(dealA, stageATarget);
  let moved = requireSuccess(
    await queryAs(
      ownerA,
      'SELECT stage_id::text AS stage_id, updated_at::text AS updated_at FROM public.deals WHERE id = $1',
      [dealA]
    ),
    'owner moved deal'
  );
  assert.equal(moved.rows[0].stage_id, stageATarget);
  assert.notEqual(moved.rows[0].updated_at, initial.rows[0].updated_at);

  await agentRepository.moveToStage(dealA, stageA);
  moved = requireSuccess(
    await queryAs(
      ownerA,
      'SELECT stage_id::text AS stage_id FROM public.deals WHERE id = $1',
      [dealA]
    ),
    'agent moved deal back'
  );
  assert.deepEqual(moved.rows, [{ stage_id: stageA }]);

  await expectAppError(
    viewerRepository.moveToStage(dealA, stageATarget),
    'forbidden'
  );
  await expectAppError(
    ownerRepository.moveToStage(dealA, stageAOtherPipeline),
    'not_found'
  );
  await expectAppError(ownerRepository.moveToStage(dealB, stageB), 'not_found');
  await expectAppError(
    ownerRepository.moveToStage(dealCrossPipelineCreator, stageA),
    'not_found'
  );
  await expectAppError(
    ownerRepository.moveToStage(dealCrossDealCreator, stageA),
    'not_found'
  );

  const finalDeal = requireSuccess(
    await queryAs(
      ownerA,
      'SELECT stage_id::text AS stage_id FROM public.deals WHERE id = $1',
      [dealA]
    ),
    'final deal state'
  );
  assert.deepEqual(finalDeal.rows, [{ stage_id: stageA }]);

  const noSessionRepository = createPostgresPipelineDealStageMoveRepository(
    async () => null
  );
  await expectAppError(
    noSessionRepository.moveToStage(dealA, stageATarget),
    'unauthorized'
  );

  const pooledIdentity = requireSuccess(
    await queryDb('SELECT auth.uid()::text AS user_id'),
    'pooled identity reset probe'
  );
  assert.deepEqual(pooledIdentity.rows, [{ user_id: null }]);

  const failClosed = requireSuccess(
    await queryDb('SELECT count(*)::int AS count FROM public.deals'),
    'missing identity RLS probe'
  );
  assert.deepEqual(failClosed.rows, [{ count: 0 }]);

  console.log(
    'PostgreSQL pipeline-deal-stage-move integration SUCCESS: NOBYPASSRLS role, stage-column-only grant, owner/agent updates, viewer denial, account/deal/pipeline-creator/stage-parent isolation, updated_at trigger, not-found concealment, fail-closed RLS, and transaction-local identity cleanup.'
  );
} finally {
  await pool.end();
}
