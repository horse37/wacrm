import assert from 'node:assert/strict';
import { AppError } from '../../src/lib/db/errors.ts';
import { queryDb } from '../../src/lib/db/postgres-client.ts';
import { getPostgresPool } from '../../src/lib/db/postgres-pool.ts';
import { createPostgresPipelineStageListRepository } from '../../src/lib/repositories/pipeline-stage-list.ts';

const ownerA = '00000000-0000-4000-8000-000000000001';
const viewerA = '00000000-0000-4000-8000-000000000003';
const ownerB = '00000000-0000-4000-8000-000000000002';
const adminC = '00000000-0000-4000-8000-000000000004';
const pipelineA = '50000000-0000-4000-8000-000000000001';
const pipelineAViewer = '50000000-0000-4000-8000-000000000003';
const pipelineCrossAccountCreator = '50000000-0000-4000-8000-000000000005';
const pipelineB = '50000000-0000-4000-8000-000000000002';
const pipelineC = '50000000-0000-4000-8000-000000000006';
const pool = getPostgresPool();

function requireSuccess(result, label) {
  if (!result.ok) throw new Error(`${label} failed with ${result.error.code}`);
  return result.data;
}

try {
  const runtime = requireSuccess(
    await queryDb(
      'SELECT current_user AS role, rolbypassrls FROM pg_roles WHERE rolname = current_user'
    ),
    'runtime role probe'
  );
  assert.deepEqual(runtime.rows, [
    { role: 'wacrm_pipeline_stage_list_runtime', rolbypassrls: false },
  ]);

  const repositoryA = createPostgresPipelineStageListRepository(async () => ({
    userId: ownerA,
  }));
  const repositoryViewerA = createPostgresPipelineStageListRepository(
    async () => ({ userId: viewerA })
  );
  const repositoryB = createPostgresPipelineStageListRepository(async () => ({
    userId: ownerB,
  }));
  const repositoryC = createPostgresPipelineStageListRepository(async () => ({
    userId: adminC,
  }));

  const stagesA = await repositoryA.listForPipeline(pipelineA);
  assert.deepEqual(stagesA, [
    {
      id: '60000000-0000-4000-8000-000000000001',
      pipeline_id: pipelineA,
      name: 'First by ID',
      position: 0,
      color: '#111111',
      created_at: '2026-10-18T11:00:00.000Z',
    },
    {
      id: '60000000-0000-4000-8000-000000000002',
      pipeline_id: pipelineA,
      name: 'Second by ID',
      position: 0,
      color: '#222222',
      created_at: '2026-10-18T09:00:00.000Z',
    },
    {
      id: '60000000-0000-4000-8000-000000000003',
      pipeline_id: pipelineA,
      name: 'Null timestamp',
      position: 2,
      color: '#333333',
      created_at: null,
    },
  ]);

  assert.deepEqual(await repositoryViewerA.listForPipeline(pipelineA), stagesA);
  assert.deepEqual(await repositoryA.listForPipeline(pipelineAViewer), [
    {
      id: '60000000-0000-4000-8000-000000000004',
      pipeline_id: pipelineAViewer,
      name: 'Other pipeline',
      position: 0,
      color: '#444444',
      created_at: '2026-10-18T10:00:00.000Z',
    },
  ]);
  assert.deepEqual(
    await repositoryA.listForPipeline(pipelineCrossAccountCreator),
    []
  );
  assert.deepEqual(await repositoryA.listForPipeline(pipelineB), []);
  assert.deepEqual(await repositoryB.listForPipeline(pipelineB), [
    {
      id: '60000000-0000-4000-8000-000000000006',
      pipeline_id: pipelineB,
      name: 'Account B stage',
      position: 0,
      color: '#666666',
      created_at: '2026-10-18T10:00:00.000Z',
    },
  ]);
  assert.deepEqual(await repositoryC.listForPipeline(pipelineC), []);

  const noSessionRepository = createPostgresPipelineStageListRepository(
    async () => null
  );
  await assert.rejects(
    noSessionRepository.listForPipeline(pipelineA),
    (error) => error instanceof AppError && error.code === 'unauthorized'
  );

  const pooledIdentity = requireSuccess(
    await queryDb('SELECT auth.uid()::text AS user_id'),
    'pooled identity reset probe'
  );
  assert.deepEqual(pooledIdentity.rows, [{ user_id: null }]);

  const failClosed = requireSuccess(
    await queryDb('SELECT count(*)::int AS count FROM public.pipeline_stages'),
    'missing identity RLS probe'
  );
  assert.deepEqual(failClosed.rows, [{ count: 0 }]);

  console.log(
    'PostgreSQL pipeline-stage-list integration SUCCESS: NOBYPASSRLS role, PipelineStage projection and null timestamp, pipeline/account/creator isolation, position/ID order, viewer access, empty result, no-session rejection, fail-closed RLS, and transaction-local identity cleanup.'
  );
} finally {
  await pool.end();
}
