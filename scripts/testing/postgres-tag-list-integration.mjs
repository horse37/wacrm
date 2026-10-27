import assert from 'node:assert/strict';
import { AppError } from '../../src/lib/db/errors.ts';
import { queryDb } from '../../src/lib/db/postgres-client.ts';
import { getPostgresPool } from '../../src/lib/db/postgres-pool.ts';
import { createPostgresTagListRepository } from '../../src/lib/repositories/tag-list.ts';

const ownerA = '00000000-0000-4000-8000-000000000001';
const viewerA = '00000000-0000-4000-8000-000000000003';
const ownerB = '00000000-0000-4000-8000-000000000002';
const ownerC = '00000000-0000-4000-8000-000000000004';
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
    { role: 'wacrm_tag_list_runtime', rolbypassrls: false },
  ]);

  const repositoryA = createPostgresTagListRepository(async () => ({
    userId: ownerA,
  }));
  const repositoryViewerA = createPostgresTagListRepository(async () => ({
    userId: viewerA,
  }));
  const repositoryB = createPostgresTagListRepository(async () => ({
    userId: ownerB,
  }));
  const repositoryC = createPostgresTagListRepository(async () => ({
    userId: ownerC,
  }));

  const tagsA = await repositoryA.list();
  assert.deepEqual(
    tagsA.map((tag) => tag.id),
    [
      '60000000-0000-4000-8000-000000000001',
      '60000000-0000-4000-8000-000000000002',
      '60000000-0000-4000-8000-000000000003',
    ]
  );
  assert.deepEqual(tagsA[0], {
    id: '60000000-0000-4000-8000-000000000001',
    user_id: ownerA,
    name: 'Synthetic A1',
    color: '#10b981',
    created_at: '2026-10-18T10:00:00.000Z',
  });
  assert.deepEqual(await repositoryViewerA.list(), tagsA);
  assert.deepEqual(
    (await repositoryB.list()).map((tag) => tag.id),
    ['60000000-0000-4000-8000-000000000004']
  );
  assert.deepEqual(await repositoryC.list(), []);

  const noSessionRepository = createPostgresTagListRepository(async () => null);
  await assert.rejects(
    noSessionRepository.list(),
    (error) => error instanceof AppError && error.code === 'unauthorized'
  );

  const pooledIdentity = requireSuccess(
    await queryDb('SELECT auth.uid()::text AS user_id'),
    'pooled identity reset probe'
  );
  assert.deepEqual(pooledIdentity.rows, [{ user_id: null }]);

  const failClosed = requireSuccess(
    await queryDb('SELECT count(*)::int AS count FROM public.tags'),
    'missing identity RLS probe'
  );
  assert.deepEqual(failClosed.rows, [{ count: 0 }]);

  console.log(
    'PostgreSQL tag-list integration SUCCESS: NOBYPASSRLS role, account isolation, viewer access, stable tag projection, empty account, and transaction-local identity cleanup.'
  );
} finally {
  await pool.end();
}
