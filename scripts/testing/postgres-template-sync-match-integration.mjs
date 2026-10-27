import assert from 'node:assert/strict';
import { AppError } from '../../src/lib/db/errors.ts';
import { queryDb } from '../../src/lib/db/postgres-client.ts';
import { getPostgresPool } from '../../src/lib/db/postgres-pool.ts';
import { createPostgresTemplateSyncMatchRepository } from '../../src/lib/repositories/template-sync-match.ts';

const viewerA = '00000000-0000-4000-8000-000000000003';
const ownerB = '00000000-0000-4000-8000-000000000002';
const pool = getPostgresPool();

function requireSuccess(result, label) {
  if (!result.ok) throw new Error(`${label} failed with ${result.error.code}`);
  return result.data;
}

try {
  const runtime = requireSuccess(
    await queryDb(
      `SELECT current_user AS role, rolbypassrls
       FROM pg_roles WHERE rolname = current_user`
    ),
    'runtime role probe'
  );
  assert.deepEqual(runtime.rows, [
    { role: 'wacrm_template_sync_runtime', rolbypassrls: false },
  ]);

  const rls = requireSuccess(
    await queryDb(
      `SELECT c.relname, c.relrowsecurity, c.relforcerowsecurity
       FROM pg_class AS c
       INNER JOIN pg_namespace AS n ON n.oid = c.relnamespace
       WHERE n.nspname = 'public'
         AND c.relname = ANY($1::text[])
       ORDER BY c.relname`,
      [['accounts', 'profiles', 'message_templates']]
    ),
    'forced RLS probe'
  );
  assert.deepEqual(rls.rows, [
    { relname: 'accounts', relrowsecurity: true, relforcerowsecurity: true },
    {
      relname: 'message_templates',
      relrowsecurity: true,
      relforcerowsecurity: true,
    },
    { relname: 'profiles', relrowsecurity: true, relforcerowsecurity: true },
  ]);

  const grants = requireSuccess(
    await queryDb(
      `SELECT table_name, column_name, privilege_type
       FROM information_schema.role_column_grants
       WHERE grantee = current_user AND table_schema = 'public'
       ORDER BY table_name, column_name`
    ),
    'runtime column grant probe'
  );
  const expectedColumns = [
    'accounts.id',
    'accounts.name',
    'message_templates.account_id',
    'message_templates.id',
    'message_templates.language',
    'message_templates.name',
    'message_templates.user_id',
    'profiles.account_id',
    'profiles.account_role',
    'profiles.user_id',
  ].sort();
  assert.deepEqual(
    grants.rows.map((row) => `${row.table_name}.${row.column_name}`),
    expectedColumns
  );
  assert.ok(grants.rows.every((row) => row.privilege_type === 'SELECT'));

  const tableGrants = requireSuccess(
    await queryDb(
      `SELECT table_name, privilege_type
       FROM information_schema.role_table_grants
       WHERE grantee = current_user AND table_schema = 'public'
       ORDER BY table_name, privilege_type`
    ),
    'runtime table grant probe'
  );
  assert.deepEqual(tableGrants.rows, []);

  const repositoryFor = (userId) =>
    createPostgresTemplateSyncMatchRepository(async () => ({ userId }));
  const viewerRepository = repositoryFor(viewerA);
  assert.equal(
    await viewerRepository.findExistingId({
      name: 'Existing A',
      language: 'pt_BR',
    }),
    '30000000-0000-4000-8000-000000000009'
  );
  assert.equal(
    await viewerRepository.findExistingId({
      name: 'Existing A',
      language: 'en_US',
    }),
    '30000000-0000-4000-8000-000000000008'
  );
  assert.equal(
    await repositoryFor(ownerB).findExistingId({
      name: 'Existing A',
      language: 'pt_BR',
    }),
    '30000000-0000-4000-8000-000000000005'
  );
  assert.equal(
    await viewerRepository.findExistingId({
      name: 'Missing',
      language: 'pt_BR',
    }),
    null
  );
  assert.equal(
    await viewerRepository.findExistingId({
      name: 'Orphan A',
      language: 'en_US',
    }),
    null
  );
  await assert.rejects(
    viewerRepository.findExistingId({ name: 'Duplicate A', language: 'en_US' }),
    (error) => error instanceof AppError && error.code === 'conflict'
  );

  const noSessionRepository = createPostgresTemplateSyncMatchRepository(
    async () => null
  );
  await assert.rejects(
    noSessionRepository.findExistingId({
      name: 'Existing A',
      language: 'pt_BR',
    }),
    (error) => error instanceof AppError && error.code === 'unauthorized'
  );

  const pooledIdentity = requireSuccess(
    await queryDb('SELECT auth.uid()::text AS user_id'),
    'pooled identity reset probe'
  );
  assert.deepEqual(pooledIdentity.rows, [{ user_id: null }]);

  const failClosedTemplates = requireSuccess(
    await queryDb(
      'SELECT count(id)::int AS count FROM public.message_templates'
    ),
    'missing identity template RLS probe'
  );
  assert.deepEqual(failClosedTemplates.rows, [{ count: 0 }]);

  console.log(
    'PostgreSQL template sync match integration SUCCESS: forced RLS, NOBYPASSRLS, exact minimum SELECT grants, account/name/language matching, creator consistency, null/missing and ambiguous handling, and transaction-local identity cleanup.'
  );
} finally {
  await pool.end();
}
