import assert from 'node:assert/strict';
import { AppError } from '../../src/lib/db/errors.ts';
import { queryDb } from '../../src/lib/db/postgres-client.ts';
import { getPostgresPool } from '../../src/lib/db/postgres-pool.ts';
import { createPostgresApprovedBroadcastTemplateRepository } from '../../src/lib/repositories/approved-broadcast-templates.ts';

const ownerA = '00000000-0000-4000-8000-000000000001';
const viewerA = '00000000-0000-4000-8000-000000000003';
const agentA = '00000000-0000-4000-8000-000000000005';
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
      `SELECT current_user AS role, rolbypassrls
       FROM pg_roles WHERE rolname = current_user`
    ),
    'runtime role probe'
  );
  assert.deepEqual(runtime.rows, [
    { role: 'wacrm_approved_template_runtime', rolbypassrls: false },
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
    'message_templates.body_text',
    'message_templates.category',
    'message_templates.created_at',
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
    createPostgresApprovedBroadcastTemplateRepository(async () => ({ userId }));
  const approvedA = await repositoryFor(ownerA).listForCurrentAccount();
  assert.deepEqual(approvedA, [
    {
      id: '30000000-0000-4000-8000-000000000003',
      name: 'Newest approved',
      category: 'Marketing',
      language: 'pt_BR',
      body_text: 'Olá {{1}}',
    },
    {
      id: '30000000-0000-4000-8000-000000000001',
      name: 'Tie-break approved',
      category: 'Authentication',
      language: 'en_US',
      body_text: 'Código {{1}}',
    },
    {
      id: '30000000-0000-4000-8000-000000000002',
      name: 'Older approved',
      category: 'Utility',
      language: null,
      body_text: 'Confirmação',
    },
  ]);
  for (const template of approvedA) {
    assert.deepEqual(Object.keys(template).sort(), [
      'body_text',
      'category',
      'id',
      'language',
      'name',
    ]);
  }
  for (const excludedValue of [
    'SYNTHETIC_META_ID_MUST_NOT_LEAK',
    'SYNTHETIC_HEADER_HANDLE_MUST_NOT_LEAK',
    'SYNTHETIC_SAMPLE_MUST_NOT_LEAK',
    'SYNTHETIC_SUBMISSION_ERROR_MUST_NOT_LEAK',
    'Pending template',
    'Foreign approved',
    'Foreign creator',
  ]) {
    assert.equal(JSON.stringify(approvedA).includes(excludedValue), false);
  }

  assert.deepEqual(
    await repositoryFor(viewerA).listForCurrentAccount(),
    approvedA
  );
  assert.deepEqual(
    await repositoryFor(agentA).listForCurrentAccount(),
    approvedA
  );
  const approvedB = await repositoryFor(ownerB).listForCurrentAccount();
  assert.deepEqual(approvedB, [
    {
      id: '30000000-0000-4000-8000-000000000005',
      name: 'Foreign approved',
      category: 'Marketing',
      language: 'pt_BR',
      body_text: 'Conta B',
    },
  ]);
  assert.deepEqual(await repositoryFor(adminC).listForCurrentAccount(), []);

  const noSessionRepository = createPostgresApprovedBroadcastTemplateRepository(
    async () => null
  );
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
    'PostgreSQL approved-template integration SUCCESS: forced RLS, NOBYPASSRLS, exact minimum column SELECT grants, account/creator isolation, owner/agent/viewer access, approved-only unbounded ordering, nullable language, minimal DTO, and transaction-local identity cleanup.'
  );
} finally {
  await pool.end();
}
