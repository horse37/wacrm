import assert from 'node:assert/strict';
import { AppError } from '../../src/lib/db/errors.ts';
import { queryDb } from '../../src/lib/db/postgres-client.ts';
import { getPostgresPool } from '../../src/lib/db/postgres-pool.ts';
import { createPostgresContactCustomValuesRepository } from '../../src/lib/repositories/contact-custom-values.ts';

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
    { role: 'wacrm_contact_custom_values_runtime', rolbypassrls: false },
  ]);

  const repositoryA = createPostgresContactCustomValuesRepository(async () => ({
    userId: ownerA,
  }));
  const repositoryViewerA = createPostgresContactCustomValuesRepository(
    async () => ({ userId: viewerA })
  );
  const repositoryB = createPostgresContactCustomValuesRepository(async () => ({
    userId: ownerB,
  }));
  const repositoryC = createPostgresContactCustomValuesRepository(async () => ({
    userId: adminC,
  }));

  const valuesA = await repositoryA.listForContact(contactA);
  assert.deepEqual(valuesA, [
    {
      id: '90000000-0000-4000-8000-000000000002',
      contact_id: contactA,
      custom_field_id: '70000000-0000-4000-8000-000000000001',
    },
    {
      id: '90000000-0000-4000-8000-000000000001',
      contact_id: contactA,
      custom_field_id: '70000000-0000-4000-8000-000000000002',
      value: 'Synthetic value A2',
    },
  ]);
  assert.deepEqual(await repositoryViewerA.listForContact(contactA), valuesA);
  assert.deepEqual(await repositoryA.listForContact(contactAEmpty), []);
  assert.deepEqual(await repositoryA.listForContact(contactB), []);
  assert.deepEqual(await repositoryB.listForContact(contactB), [
    {
      id: '90000000-0000-4000-8000-000000000004',
      contact_id: contactB,
      custom_field_id: '70000000-0000-4000-8000-000000000003',
      value: 'Synthetic value B1',
    },
  ]);
  assert.deepEqual(await repositoryC.listForContact(contactA), []);

  const noSessionRepository = createPostgresContactCustomValuesRepository(
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
    await queryDb(
      'SELECT count(*)::int AS count FROM public.contact_custom_values'
    ),
    'missing identity RLS probe'
  );
  assert.deepEqual(failClosed.rows, [{ count: 0 }]);

  console.log(
    'PostgreSQL contact-custom-value integration SUCCESS: NOBYPASSRLS role, projection/null handling, stable order, account/contact isolation, cross-account field-link exclusion, viewer access, empty result, invalid/no-session rejection, and transaction-local identity cleanup.'
  );
} finally {
  await pool.end();
}
