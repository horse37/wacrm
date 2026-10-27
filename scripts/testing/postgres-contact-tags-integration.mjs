import assert from 'node:assert/strict';
import { AppError } from '../../src/lib/db/errors.ts';
import { queryDb } from '../../src/lib/db/postgres-client.ts';
import { getPostgresPool } from '../../src/lib/db/postgres-pool.ts';
import { createPostgresContactTagsRepository } from '../../src/lib/repositories/contact-tags.ts';

const ownerA = '00000000-0000-4000-8000-000000000001';
const viewerA = '00000000-0000-4000-8000-000000000003';
const ownerB = '00000000-0000-4000-8000-000000000002';
const contactA = '40000000-0000-4000-8000-000000000001';
const contactAWithoutTags = '40000000-0000-4000-8000-000000000002';
const contactB = '40000000-0000-4000-8000-000000000003';
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
    { role: 'wacrm_contact_tags_runtime', rolbypassrls: false },
  ]);

  const repositoryA = createPostgresContactTagsRepository(async () => ({
    userId: ownerA,
  }));
  const repositoryViewerA = createPostgresContactTagsRepository(async () => ({
    userId: viewerA,
  }));
  const repositoryB = createPostgresContactTagsRepository(async () => ({
    userId: ownerB,
  }));

  const assignmentsA = await repositoryA.listForContact(contactA);
  assert.deepEqual(assignmentsA, [
    {
      id: '80000000-0000-4000-8000-000000000001',
      contact_id: contactA,
      tag_id: '60000000-0000-4000-8000-000000000001',
    },
    {
      id: '80000000-0000-4000-8000-000000000002',
      contact_id: contactA,
      tag_id: '60000000-0000-4000-8000-000000000002',
    },
  ]);
  assert.deepEqual(
    await repositoryViewerA.listForContact(contactA),
    assignmentsA
  );
  assert.deepEqual(await repositoryA.listForContact(contactAWithoutTags), []);
  assert.deepEqual(await repositoryA.listForContact(contactB), []);
  assert.deepEqual(await repositoryB.listForContact(contactB), [
    {
      id: '80000000-0000-4000-8000-000000000004',
      contact_id: contactB,
      tag_id: '60000000-0000-4000-8000-000000000003',
    },
  ]);

  const noSessionRepository = createPostgresContactTagsRepository(
    async () => null
  );
  await assert.rejects(
    noSessionRepository.listForContact(contactA),
    (error) => error instanceof AppError && error.code === 'unauthorized'
  );
  await assert.rejects(
    repositoryA.listForContact('not-a-uuid'),
    (error) => error instanceof AppError && error.code === 'bad_request'
  );

  const pooledIdentity = requireSuccess(
    await queryDb('SELECT auth.uid()::text AS user_id'),
    'pooled identity reset probe'
  );
  assert.deepEqual(pooledIdentity.rows, [{ user_id: null }]);

  const failClosed = requireSuccess(
    await queryDb('SELECT count(*)::int AS count FROM public.contact_tags'),
    'missing identity RLS probe'
  );
  assert.deepEqual(failClosed.rows, [{ count: 0 }]);

  console.log(
    'PostgreSQL contact-tag integration SUCCESS: NOBYPASSRLS role, assignment projection/order, account and tag-parent isolation, viewer access, invalid/no-session rejection, empty result, and transaction-local identity cleanup.'
  );
} finally {
  await pool.end();
}
