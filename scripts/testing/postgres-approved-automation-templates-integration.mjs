import assert from 'node:assert/strict';
import { AppError } from '../../src/lib/db/errors.ts';
import { queryDb } from '../../src/lib/db/postgres-client.ts';
import { getPostgresPool } from '../../src/lib/db/postgres-pool.ts';
import { createPostgresApprovedAutomationTemplatesRepository } from '../../src/lib/repositories/approved-automation-templates.ts';

const ownerA = '00000000-0000-4000-8000-000000000001';
const viewerA = '00000000-0000-4000-8000-000000000003';
const agentA = '00000000-0000-4000-8000-000000000005';
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
    {
      role: 'wacrm_approved_automation_templates_runtime',
      rolbypassrls: false,
    },
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
    'profiles.account_id',
    'profiles.account_role',
    'profiles.user_id',
    'message_templates.account_id',
    'message_templates.id',
    'message_templates.language',
    'message_templates.name',
    'message_templates.status',
    'message_templates.user_id',
  ].sort();
  const actualColumns = grants.rows.map(
    (row) => `${row.table_name}.${row.column_name}`
  );
  assert.deepEqual(actualColumns, expectedColumns);
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
    createPostgresApprovedAutomationTemplatesRepository(async () => ({
      userId,
    }));
  const expectedAccountA = [
    {
      id: '30000000-0000-4000-8000-000000000001',
      name: 'Alpha',
      language: 'pt_BR',
    },
    {
      id: '30000000-0000-4000-8000-000000000003',
      name: 'Alpha',
      language: 'en_US',
    },
    {
      id: '30000000-0000-4000-8000-000000000004',
      name: 'Beta',
      language: null,
    },
  ];
  const ownerOptions = await repositoryFor(ownerA).listForCurrentAccount();
  assert.deepEqual(ownerOptions, expectedAccountA);
  assert.deepEqual(Object.keys(ownerOptions[0]).sort(), [
    'id',
    'language',
    'name',
  ]);
  for (const excludedValue of [
    'SYNTHETIC_HEADER_HANDLE_MUST_NOT_LEAK',
    'SYNTHETIC_META_ID_MUST_NOT_LEAK',
  ]) {
    assert.equal(JSON.stringify(ownerOptions).includes(excludedValue), false);
  }

  assert.deepEqual(
    await repositoryFor(viewerA).listForCurrentAccount(),
    expectedAccountA
  );
  assert.deepEqual(
    await repositoryFor(agentA).listForCurrentAccount(),
    expectedAccountA
  );
  assert.deepEqual(await repositoryFor(ownerB).listForCurrentAccount(), [
    {
      id: '30000000-0000-4000-8000-000000000005',
      name: 'Gamma',
      language: 'en_US',
    },
  ]);

  const noSessionRepository =
    createPostgresApprovedAutomationTemplatesRepository(async () => null);
  await assert.rejects(
    noSessionRepository.listForCurrentAccount(),
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
    'PostgreSQL approved automation-template integration SUCCESS: forced RLS, NOBYPASSRLS, exact minimum column SELECT grants, account-member visibility, approved-only filtering, creator consistency, stable alphabetical/UUID order, minimal DTO, and transaction-local identity cleanup.'
  );
} finally {
  await pool.end();
}
