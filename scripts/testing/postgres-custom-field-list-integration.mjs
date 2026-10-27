import assert from 'node:assert/strict';
import { AppError } from '../../src/lib/db/errors.ts';
import { queryDb } from '../../src/lib/db/postgres-client.ts';
import { getPostgresPool } from '../../src/lib/db/postgres-pool.ts';
import { createPostgresCustomFieldListRepository } from '../../src/lib/repositories/custom-field-list.ts';

const ownerA = '00000000-0000-4000-8000-000000000001';
const viewerA = '00000000-0000-4000-8000-000000000003';
const ownerB = '00000000-0000-4000-8000-000000000002';
const adminC = '00000000-0000-4000-8000-000000000004';
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
    { role: 'wacrm_custom_fields_runtime', rolbypassrls: false },
  ]);

  const repositoryA = createPostgresCustomFieldListRepository(async () => ({
    userId: ownerA,
  }));
  const repositoryViewerA = createPostgresCustomFieldListRepository(
    async () => ({ userId: viewerA })
  );
  const repositoryB = createPostgresCustomFieldListRepository(async () => ({
    userId: ownerB,
  }));
  const repositoryC = createPostgresCustomFieldListRepository(async () => ({
    userId: adminC,
  }));

  const fieldsA = await repositoryA.list();
  assert.deepEqual(fieldsA, [
    {
      id: '70000000-0000-4000-8000-000000000001',
      user_id: ownerA,
      account_id: '10000000-0000-4000-8000-000000000001',
      field_name: 'Alpha',
      field_type: 'text',
      field_options: { maxLength: 80, nested: { enabled: true } },
      created_at: '2026-10-18T10:00:00.000Z',
    },
    {
      id: '70000000-0000-4000-8000-000000000002',
      user_id: ownerA,
      account_id: '10000000-0000-4000-8000-000000000001',
      field_name: 'Alpha',
      field_type: 'number',
      created_at: '2026-10-18T10:00:00.000Z',
    },
    {
      id: '70000000-0000-4000-8000-000000000003',
      user_id: ownerA,
      account_id: '10000000-0000-4000-8000-000000000001',
      field_name: 'Beta',
      field_type: 'text',
      created_at: '2026-10-18T10:00:00.000Z',
    },
  ]);
  assert.deepEqual(await repositoryViewerA.list(), fieldsA);
  assert.deepEqual(await repositoryB.list(), [
    {
      id: '70000000-0000-4000-8000-000000000004',
      user_id: ownerB,
      account_id: '10000000-0000-4000-8000-000000000002',
      field_name: 'Foreign field',
      field_type: 'text',
      created_at: '2026-10-18T11:00:00.000Z',
    },
  ]);
  assert.deepEqual(await repositoryC.list(), []);

  const noSessionRepository = createPostgresCustomFieldListRepository(
    async () => null
  );
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
    await queryDb('SELECT count(*)::int AS count FROM public.custom_fields'),
    'missing identity RLS probe'
  );
  assert.deepEqual(failClosed.rows, [{ count: 0 }]);

  console.log(
    'PostgreSQL custom-field integration SUCCESS: NOBYPASSRLS role, projection/options, alphabetical and stable order, account isolation, viewer access, empty result, no-session rejection, and transaction-local identity cleanup.'
  );
} finally {
  await pool.end();
}
