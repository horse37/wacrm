import assert from 'node:assert/strict';
import { AppError } from '../../src/lib/db/errors.ts';
import { queryDb } from '../../src/lib/db/postgres-client.ts';
import { getPostgresPool } from '../../src/lib/db/postgres-pool.ts';
import { createPostgresContactListRepository } from '../../src/lib/repositories/contact-list.ts';

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
    { role: 'wacrm_contact_list_runtime', rolbypassrls: false },
  ]);

  const repositoryA = createPostgresContactListRepository(async () => ({
    userId: ownerA,
  }));
  const repositoryViewerA = createPostgresContactListRepository(async () => ({
    userId: viewerA,
  }));
  const repositoryB = createPostgresContactListRepository(async () => ({
    userId: ownerB,
  }));
  const repositoryC = createPostgresContactListRepository(async () => ({
    userId: ownerC,
  }));

  const firstPage = await repositoryA.listPage({ page: 0, pageSize: 2 });
  assert.equal(firstPage.totalCount, 4);
  assert.deepEqual(
    firstPage.contacts.map((contact) => contact.id),
    [
      '40000000-0000-4000-8000-000000000003',
      '40000000-0000-4000-8000-000000000004',
    ]
  );
  assert.equal(firstPage.contacts[0].phone_normalized, '15550000003');

  const secondPage = await repositoryA.listPage({ page: 1, pageSize: 2 });
  assert.equal(secondPage.totalCount, 4);
  assert.deepEqual(
    secondPage.contacts.map((contact) => contact.id),
    [
      '40000000-0000-4000-8000-000000000002',
      '40000000-0000-4000-8000-000000000001',
    ]
  );

  assert.deepEqual(await repositoryA.listPage({ page: 2, pageSize: 2 }), {
    contacts: [],
    totalCount: 4,
  });
  assert.deepEqual(
    await repositoryViewerA.listPage({ page: 0, pageSize: 2 }),
    firstPage
  );
  assert.deepEqual(
    await repositoryA
      .listPage({ page: 0, search: '%_' })
      .then((page) => page.contacts.map((contact) => contact.id)),
    ['40000000-0000-4000-8000-000000000002']
  );
  assert.deepEqual(
    await repositoryA
      .listPage({ page: 0, search: 'ALPHA-A1@EXAMPLE.INVALID' })
      .then((page) => page.contacts.map((contact) => contact.id)),
    ['40000000-0000-4000-8000-000000000001']
  );
  assert.deepEqual(
    (await repositoryB.listPage({ page: 0 })).contacts.map(
      (contact) => contact.id
    ),
    ['40000000-0000-4000-8000-000000000005']
  );
  assert.deepEqual(await repositoryC.listPage({ page: 0 }), {
    contacts: [],
    totalCount: 0,
  });

  const noSessionRepository = createPostgresContactListRepository(
    async () => null
  );
  await assert.rejects(
    noSessionRepository.listPage({ page: 0 }),
    (error) => error instanceof AppError && error.code === 'unauthorized'
  );
  await assert.rejects(
    repositoryA.listPage({ page: -1 }),
    (error) => error instanceof AppError && error.code === 'bad_request'
  );

  const pooledIdentity = requireSuccess(
    await queryDb('SELECT auth.uid()::text AS user_id'),
    'pooled identity reset probe'
  );
  assert.deepEqual(pooledIdentity.rows, [{ user_id: null }]);

  const failClosed = requireSuccess(
    await queryDb('SELECT count(*)::int AS count FROM public.contacts'),
    'missing identity RLS probe'
  );
  assert.deepEqual(failClosed.rows, [{ count: 0 }]);

  console.log(
    'PostgreSQL contact-list integration SUCCESS: NOBYPASSRLS role, exact paged counts, account isolation, literal ILIKE search, empty pages, and transaction-local identity cleanup.'
  );
} finally {
  await pool.end();
}
