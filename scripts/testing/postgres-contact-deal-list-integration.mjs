import assert from 'node:assert/strict';
import { AppError } from '../../src/lib/db/errors.ts';
import { queryDb } from '../../src/lib/db/postgres-client.ts';
import { getPostgresPool } from '../../src/lib/db/postgres-pool.ts';
import { createPostgresContactDealListRepository } from '../../src/lib/repositories/contact-deal-list.ts';

const ownerA = '00000000-0000-4000-8000-000000000001';
const viewerA = '00000000-0000-4000-8000-000000000003';
const ownerB = '00000000-0000-4000-8000-000000000002';
const adminC = '00000000-0000-4000-8000-000000000004';
const contactA = '40000000-0000-4000-8000-000000000001';
const contactAEmpty = '40000000-0000-4000-8000-000000000002';
const contactB = '40000000-0000-4000-8000-000000000003';
const pipelineA = '50000000-0000-4000-8000-000000000001';
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
    { role: 'wacrm_contact_deals_runtime', rolbypassrls: false },
  ]);

  const repositoryA = createPostgresContactDealListRepository(async () => ({
    userId: ownerA,
  }));
  const repositoryViewerA = createPostgresContactDealListRepository(
    async () => ({ userId: viewerA })
  );
  const repositoryB = createPostgresContactDealListRepository(async () => ({
    userId: ownerB,
  }));
  const repositoryC = createPostgresContactDealListRepository(async () => ({
    userId: adminC,
  }));

  const dealsA = await repositoryA.listForContact(contactA);
  assert.deepEqual(dealsA, [
    {
      id: '90000000-0000-4000-8000-000000000002',
      user_id: ownerA,
      pipeline_id: pipelineA,
      stage_id: stageA,
      contact_id: contactA,
      conversation_id: '70000000-0000-4000-8000-000000000001',
      assigned_to: ownerA,
      title: 'Synthetic deal A2',
      value: 123.45,
      currency: 'CAD',
      expected_close_date: '2026-11-30',
      status: 'won',
      created_at: '2026-10-18T12:00:00.000Z',
    },
    {
      id: '90000000-0000-4000-8000-000000000001',
      user_id: ownerA,
      pipeline_id: pipelineA,
      stage_id: stageA,
      contact_id: contactA,
      title: 'Synthetic deal A1',
      value: 100,
      currency: 'USD',
      notes: 'First synthetic deal',
      expected_close_date: '2026-12-01',
      status: 'open',
      created_at: '2026-10-18T12:00:00.000Z',
      updated_at: '2026-10-18T12:30:00.000Z',
    },
    {
      id: '90000000-0000-4000-8000-000000000003',
      user_id: ownerA,
      pipeline_id: pipelineA,
      stage_id: stageA,
      contact_id: contactA,
      title: 'Synthetic deal A3',
      value: 0,
      created_at: '2026-10-18T11:00:00.000Z',
    },
  ]);

  assert.deepEqual(await repositoryViewerA.listForContact(contactA), dealsA);
  assert.deepEqual(await repositoryA.listForContact(contactAEmpty), []);
  assert.deepEqual(await repositoryA.listForContact(contactB), []);
  assert.deepEqual(await repositoryB.listForContact(contactB), [
    {
      id: '90000000-0000-4000-8000-000000000007',
      user_id: ownerB,
      pipeline_id: '50000000-0000-4000-8000-000000000002',
      stage_id: '60000000-0000-4000-8000-000000000002',
      contact_id: contactB,
      title: 'Synthetic deal B1',
      value: 200,
      currency: 'USD',
      status: 'open',
      created_at: '2026-10-18T13:00:00.000Z',
    },
  ]);
  assert.deepEqual(await repositoryC.listForContact(contactA), []);

  const noSessionRepository = createPostgresContactDealListRepository(
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
    await queryDb('SELECT count(*)::int AS count FROM public.deals'),
    'missing identity RLS probe'
  );
  assert.deepEqual(failClosed.rows, [{ count: 0 }]);

  console.log(
    'PostgreSQL contact-deal integration SUCCESS: NOBYPASSRLS role, Deal projection, NUMERIC conversion, newest-first/ID order, account/contact/pipeline/stage isolation, viewer access, empty result, invalid/no-session rejection, and transaction-local identity cleanup.'
  );
} finally {
  await pool.end();
}
