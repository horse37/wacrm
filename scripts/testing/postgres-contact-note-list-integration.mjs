import assert from 'node:assert/strict';
import { AppError } from '../../src/lib/db/errors.ts';
import { queryDb } from '../../src/lib/db/postgres-client.ts';
import { getPostgresPool } from '../../src/lib/db/postgres-pool.ts';
import { createPostgresContactNoteListRepository } from '../../src/lib/repositories/contact-note-list.ts';

const ownerA = '00000000-0000-4000-8000-000000000001';
const viewerA = '00000000-0000-4000-8000-000000000003';
const ownerB = '00000000-0000-4000-8000-000000000002';
const adminC = '00000000-0000-4000-8000-000000000004';
const contactA = '40000000-0000-4000-8000-000000000001';
const contactAEmpty = '40000000-0000-4000-8000-000000000002';
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
    { role: 'wacrm_contact_notes_runtime', rolbypassrls: false },
  ]);

  const repositoryA = createPostgresContactNoteListRepository(async () => ({
    userId: ownerA,
  }));
  const repositoryViewerA = createPostgresContactNoteListRepository(
    async () => ({ userId: viewerA })
  );
  const repositoryB = createPostgresContactNoteListRepository(async () => ({
    userId: ownerB,
  }));
  const repositoryC = createPostgresContactNoteListRepository(async () => ({
    userId: adminC,
  }));

  const notesA = await repositoryA.listForContact(contactA);
  assert.deepEqual(notesA, [
    {
      id: '80000000-0000-4000-8000-000000000002',
      contact_id: contactA,
      user_id: ownerA,
      note_text: 'Synthetic note A2',
      created_at: '2026-10-18T12:00:00.000Z',
    },
    {
      id: '80000000-0000-4000-8000-000000000001',
      contact_id: contactA,
      user_id: ownerA,
      note_text: 'Synthetic note A1',
      created_at: '2026-10-18T12:00:00.000Z',
    },
    {
      id: '80000000-0000-4000-8000-000000000003',
      contact_id: contactA,
      user_id: ownerA,
      note_text: 'Synthetic older note A3',
      created_at: '2026-10-18T11:00:00.000Z',
    },
  ]);
  assert.deepEqual(await repositoryViewerA.listForContact(contactA), notesA);
  assert.deepEqual(await repositoryA.listForContact(contactAEmpty), []);
  assert.deepEqual(await repositoryA.listForContact(contactB), []);
  assert.deepEqual(await repositoryB.listForContact(contactB), [
    {
      id: '80000000-0000-4000-8000-000000000005',
      contact_id: contactB,
      user_id: ownerB,
      note_text: 'Synthetic note B1',
      created_at: '2026-10-18T14:00:00.000Z',
    },
  ]);
  assert.deepEqual(await repositoryC.listForContact(contactA), []);

  const noSessionRepository = createPostgresContactNoteListRepository(
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
    await queryDb('SELECT count(*)::int AS count FROM public.contact_notes'),
    'missing identity RLS probe'
  );
  assert.deepEqual(failClosed.rows, [{ count: 0 }]);

  console.log(
    'PostgreSQL contact-note integration SUCCESS: NOBYPASSRLS role, projection, newest-first/ID order, account/contact isolation, mismatched-parent exclusion, viewer access, empty result, invalid/no-session rejection, and transaction-local identity cleanup.'
  );
} finally {
  await pool.end();
}
