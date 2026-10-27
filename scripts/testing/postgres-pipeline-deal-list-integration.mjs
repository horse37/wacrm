import assert from 'node:assert/strict';
import { AppError } from '../../src/lib/db/errors.ts';
import { queryDb } from '../../src/lib/db/postgres-client.ts';
import { getPostgresPool } from '../../src/lib/db/postgres-pool.ts';
import { createPostgresPipelineDealListRepository } from '../../src/lib/repositories/pipeline-deal-list.ts';

const ownerA = '00000000-0000-4000-8000-000000000001';
const viewerA = '00000000-0000-4000-8000-000000000003';
const ownerB = '00000000-0000-4000-8000-000000000002';
const pipelineA = '50000000-0000-4000-8000-000000000001';
const pipelineAOther = '50000000-0000-4000-8000-000000000003';
const pipelineAEmpty = '50000000-0000-4000-8000-000000000004';
const pipelineCrossCreator = '50000000-0000-4000-8000-000000000005';
const pipelineB = '50000000-0000-4000-8000-000000000002';
const contactA = '40000000-0000-4000-8000-000000000001';
const contactB = '40000000-0000-4000-8000-000000000002';
const profileA = '90000000-0000-4000-8000-000000000001';
const profileB = '90000000-0000-4000-8000-000000000002';
const stageA = '60000000-0000-4000-8000-000000000001';
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
    { role: 'wacrm_pipeline_deal_list_runtime', rolbypassrls: false },
  ]);

  const repositoryA = createPostgresPipelineDealListRepository(async () => ({
    userId: ownerA,
  }));
  const repositoryViewerA = createPostgresPipelineDealListRepository(
    async () => ({ userId: viewerA })
  );
  const repositoryB = createPostgresPipelineDealListRepository(async () => ({
    userId: ownerB,
  }));

  const dealsA = await repositoryA.listForPipeline(pipelineA);
  assert.deepEqual(dealsA, [
    {
      id: '70000000-0000-4000-8000-000000000003',
      user_id: ownerA,
      pipeline_id: pipelineA,
      stage_id: stageA,
      contact_id: contactB,
      assigned_to: profileB,
      title: 'Cross-account relation deal',
      value: 50.25,
      currency: 'BRL',
      status: 'open',
      created_at: '2026-10-20T10:00:00.000Z',
      updated_at: '2026-10-20T11:00:00.000Z',
    },
    {
      id: '70000000-0000-4000-8000-000000000001',
      user_id: ownerA,
      pipeline_id: pipelineA,
      stage_id: stageA,
      contact_id: contactA,
      conversation_id: '80000000-0000-4000-8000-000000000001',
      assigned_to: profileA,
      title: 'Visible synthetic deal',
      value: 450.75,
      currency: 'BRL',
      notes: 'Do not select this private note',
      expected_close_date: '2026-10-20',
      status: 'won',
      created_at: '2026-10-19T10:00:00.000Z',
      updated_at: '2026-10-19T11:00:00.000Z',
      contact: {
        id: contactA,
        phone: '+15555550123',
        name: 'Synthetic Contact A',
      },
      assignee: { id: profileA, full_name: 'Synthetic Owner A' },
    },
    {
      id: '70000000-0000-4000-8000-000000000002',
      user_id: ownerA,
      pipeline_id: pipelineA,
      stage_id: stageA,
      contact_id: null,
      title: 'Orphan synthetic deal',
      value: 0,
      created_at: null,
      updated_at: null,
    },
  ]);
  assert.deepEqual(await repositoryViewerA.listForPipeline(pipelineA), dealsA);
  assert.deepEqual(await repositoryA.listForPipeline(pipelineAEmpty), []);
  assert.deepEqual(await repositoryA.listForPipeline(pipelineB), []);
  assert.deepEqual(await repositoryA.listForPipeline(pipelineCrossCreator), []);
  assert.deepEqual(await repositoryA.listForPipeline(pipelineAOther), [
    {
      id: '70000000-0000-4000-8000-000000000005',
      user_id: ownerA,
      pipeline_id: pipelineAOther,
      stage_id: '60000000-0000-4000-8000-000000000003',
      contact_id: null,
      title: 'Other pipeline deal',
      value: 99,
      currency: 'BRL',
      status: 'open',
      created_at: '2026-10-18T10:00:00.000Z',
      updated_at: '2026-10-18T11:00:00.000Z',
    },
  ]);
  assert.deepEqual(await repositoryB.listForPipeline(pipelineB), [
    {
      id: '70000000-0000-4000-8000-000000000006',
      user_id: ownerB,
      pipeline_id: pipelineB,
      stage_id: '60000000-0000-4000-8000-000000000002',
      contact_id: contactB,
      assigned_to: profileB,
      title: 'Account B deal',
      value: 25,
      currency: 'USD',
      status: 'open',
      created_at: '2026-10-18T10:00:00.000Z',
      updated_at: '2026-10-18T11:00:00.000Z',
      contact: {
        id: contactB,
        phone: '+15555550124',
        name: 'Synthetic Contact B',
      },
      assignee: { id: profileB, full_name: 'Synthetic Owner B' },
    },
  ]);

  const noSessionRepository = createPostgresPipelineDealListRepository(
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
    await queryDb('SELECT count(*)::int AS count FROM public.deals'),
    'missing identity RLS probe'
  );
  assert.deepEqual(failClosed.rows, [{ count: 0 }]);

  console.log(
    'PostgreSQL pipeline-deal-list integration SUCCESS: NOBYPASSRLS role, board projection, account/deal/pipeline/creator/stage isolation, contact and assignee summary isolation, date/decimal/null mapping, newest-first order, viewer access, empty result, no-session rejection, fail-closed RLS, and transaction-local identity cleanup.'
  );
} finally {
  await pool.end();
}
