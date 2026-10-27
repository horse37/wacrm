import assert from 'node:assert/strict';
import { AppError } from '../../src/lib/db/errors.ts';
import { queryDb } from '../../src/lib/db/postgres-client.ts';
import { getPostgresPool } from '../../src/lib/db/postgres-pool.ts';
import { createPostgresPipelineListRepository } from '../../src/lib/repositories/pipeline-list.ts';

const ownerA = '00000000-0000-4000-8000-000000000001';
const viewerA = '00000000-0000-4000-8000-000000000003';
const ownerB = '00000000-0000-4000-8000-000000000002';
const adminC = '00000000-0000-4000-8000-000000000004';
const formerMemberA = '00000000-0000-4000-8000-000000000006';
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
    { role: 'wacrm_pipeline_list_runtime', rolbypassrls: false },
  ]);

  const repositoryA = createPostgresPipelineListRepository(async () => ({
    userId: ownerA,
  }));
  const repositoryViewerA = createPostgresPipelineListRepository(async () => ({
    userId: viewerA,
  }));
  const repositoryB = createPostgresPipelineListRepository(async () => ({
    userId: ownerB,
  }));
  const repositoryC = createPostgresPipelineListRepository(async () => ({
    userId: adminC,
  }));

  const pipelinesA = await repositoryA.listForAccount();
  assert.deepEqual(pipelinesA, [
    {
      id: '50000000-0000-4000-8000-000000000004',
      user_id: ownerA,
      name: 'Pipeline A0',
      created_at: '2026-10-17T10:00:00.000Z',
    },
    {
      id: '50000000-0000-4000-8000-000000000001',
      user_id: ownerA,
      name: 'Pipeline A1',
      created_at: '2026-10-18T10:00:00.000Z',
    },
    {
      id: '50000000-0000-4000-8000-000000000003',
      user_id: viewerA,
      name: 'Pipeline A3',
      created_at: '2026-10-18T10:00:00.000Z',
    },
    {
      id: '50000000-0000-4000-8000-000000000005',
      user_id: formerMemberA,
      name: 'Former member pipeline',
      created_at: '2026-10-18T11:00:00.000Z',
    },
    {
      id: '50000000-0000-4000-8000-000000000006',
      user_id: ownerA,
      name: 'Pipeline A null timestamp',
      created_at: null,
    },
  ]);
  assert.equal(
    pipelinesA.some(
      (pipeline) => pipeline.id === '50000000-0000-4000-8000-000000000005'
    ),
    true,
    'account-owned pipeline remains visible after creator profile moves to a personal account'
  );

  assert.deepEqual(await repositoryViewerA.listForAccount(), pipelinesA);
  assert.deepEqual(await repositoryB.listForAccount(), [
    {
      id: '50000000-0000-4000-8000-000000000002',
      user_id: ownerB,
      name: 'Pipeline B1',
      created_at: '2026-10-16T10:00:00.000Z',
    },
  ]);
  assert.deepEqual(await repositoryC.listForAccount(), []);

  const noSessionRepository = createPostgresPipelineListRepository(
    async () => null
  );
  await assert.rejects(
    noSessionRepository.listForAccount(),
    (error) => error instanceof AppError && error.code === 'unauthorized'
  );

  const pooledIdentity = requireSuccess(
    await queryDb('SELECT auth.uid()::text AS user_id'),
    'pooled identity reset probe'
  );
  assert.deepEqual(pooledIdentity.rows, [{ user_id: null }]);

  const failClosed = requireSuccess(
    await queryDb('SELECT count(*)::int AS count FROM public.pipelines'),
    'missing identity RLS probe'
  );
  assert.deepEqual(failClosed.rows, [{ count: 0 }]);

  console.log(
    'PostgreSQL pipeline-list integration SUCCESS: NOBYPASSRLS role, account-scoped visibility after creator profile moves, cross-account isolation, stable creation/ID order, viewer access, empty account, no-session rejection, fail-closed RLS, and transaction-local identity cleanup.'
  );
} finally {
  await pool.end();
}
