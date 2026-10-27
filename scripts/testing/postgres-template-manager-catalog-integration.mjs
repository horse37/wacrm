import assert from 'node:assert/strict';
import { AppError } from '../../src/lib/db/errors.ts';
import { queryDb } from '../../src/lib/db/postgres-client.ts';
import { getPostgresPool } from '../../src/lib/db/postgres-pool.ts';
import { createPostgresTemplateManagerCatalogRepository } from '../../src/lib/repositories/template-manager-catalog.ts';

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
    { role: 'wacrm_template_manager_catalog_runtime', rolbypassrls: false },
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
    'message_templates.footer_text',
    'message_templates.id',
    'message_templates.language',
    'message_templates.meta_template_id',
    'message_templates.name',
    'message_templates.quality_score',
    'message_templates.rejection_reason',
    'message_templates.status',
    'message_templates.submission_error',
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
    createPostgresTemplateManagerCatalogRepository(async () => ({ userId }));
  const ownerTemplates = await repositoryFor(ownerA).listForCurrentUser();
  assert.deepEqual(ownerTemplates, [
    {
      id: '30000000-0000-4000-8000-000000000003',
      name: 'Newest template',
      category: 'Marketing',
      status: 'PENDING',
      language: 'pt_BR',
      quality_score: 'GREEN',
      body_text: 'Olá {{1}}',
      footer_text: null,
      rejection_reason: null,
      submission_error: null,
      meta_template_id: null,
    },
    {
      id: '30000000-0000-4000-8000-000000000001',
      name: 'Tie-break template',
      category: 'Authentication',
      status: 'APPROVED',
      language: 'en_US',
      quality_score: null,
      body_text: 'Código {{1}}',
      footer_text: null,
      rejection_reason: null,
      submission_error: null,
      meta_template_id: 'SYNTHETIC_META_TEMPLATE_ID',
    },
    {
      id: '30000000-0000-4000-8000-000000000002',
      name: 'Older template',
      category: 'Utility',
      status: null,
      language: null,
      quality_score: null,
      body_text: 'Confirmação',
      footer_text: 'Até logo',
      rejection_reason: 'Synthetic rejection reason',
      submission_error: 'Synthetic submission error',
      meta_template_id: null,
    },
  ]);
  for (const template of ownerTemplates) {
    assert.deepEqual(Object.keys(template).sort(), [
      'body_text',
      'category',
      'footer_text',
      'id',
      'language',
      'meta_template_id',
      'name',
      'quality_score',
      'rejection_reason',
      'status',
      'submission_error',
    ]);
  }
  for (const excludedValue of [
    'SYNTHETIC_HEADER_HANDLE_MUST_NOT_LEAK',
    'SYNTHETIC_SAMPLE_MUST_NOT_LEAK',
  ]) {
    assert.equal(JSON.stringify(ownerTemplates).includes(excludedValue), false);
  }

  assert.deepEqual(await repositoryFor(viewerA).listForCurrentUser(), []);
  assert.deepEqual(await repositoryFor(agentA).listForCurrentUser(), [
    {
      id: '30000000-0000-4000-8000-000000000004',
      name: 'Other account member template',
      category: 'Utility',
      status: 'APPROVED',
      language: 'pt_BR',
      quality_score: null,
      body_text: 'Não deve aparecer para owner',
      footer_text: null,
      rejection_reason: null,
      submission_error: null,
      meta_template_id: null,
    },
  ]);
  assert.deepEqual(await repositoryFor(ownerB).listForCurrentUser(), [
    {
      id: '30000000-0000-4000-8000-000000000005',
      name: 'Account B template',
      category: 'Marketing',
      status: 'APPROVED',
      language: 'pt_BR',
      quality_score: null,
      body_text: 'Conta B',
      footer_text: null,
      rejection_reason: null,
      submission_error: null,
      meta_template_id: null,
    },
  ]);
  assert.deepEqual(await repositoryFor(adminC).listForCurrentUser(), []);

  const noSessionRepository = createPostgresTemplateManagerCatalogRepository(
    async () => null
  );
  await assert.rejects(
    noSessionRepository.listForCurrentUser(),
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
    'PostgreSQL template-manager catalog integration SUCCESS: forced RLS, NOBYPASSRLS, exact minimum column SELECT grants, per-user/account/creator isolation, owner/agent/viewer access, stable unbounded order, nullable legacy values, minimal DTO, and transaction-local identity cleanup.'
  );
} finally {
  await pool.end();
}
