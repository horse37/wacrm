import assert from 'node:assert/strict';
import { AppError } from '../../src/lib/db/errors.ts';
import { queryDb } from '../../src/lib/db/postgres-client.ts';
import { getPostgresPool } from '../../src/lib/db/postgres-pool.ts';
import { createPostgresTemplateEditorDetailRepository } from '../../src/lib/repositories/template-editor-detail.ts';

const ownerA = '00000000-0000-4000-8000-000000000001';
const viewerA = '00000000-0000-4000-8000-000000000003';
const agentA = '00000000-0000-4000-8000-000000000005';
const templateA = '30000000-0000-4000-8000-000000000001';
const templateAgentA = '30000000-0000-4000-8000-000000000004';
const templateB = '30000000-0000-4000-8000-000000000005';
const mismatchedTemplate = '30000000-0000-4000-8000-000000000006';
const pool = getPostgresPool();

function requireSuccess(result, label) {
  if (!result.ok) throw new Error(`${label} failed with ${result.error.code}`);
  return result.data;
}

async function expectNotFound(operation, label) {
  await assert.rejects(
    operation,
    (error) => error instanceof AppError && error.code === 'not_found',
    label
  );
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
    { role: 'wacrm_template_editor_detail_runtime', rolbypassrls: false },
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
    'message_templates.buttons',
    'message_templates.category',
    'message_templates.footer_text',
    'message_templates.header_content',
    'message_templates.header_media_url',
    'message_templates.header_type',
    'message_templates.id',
    'message_templates.language',
    'message_templates.name',
    'message_templates.sample_values',
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
    createPostgresTemplateEditorDetailRepository(async () => ({ userId }));
  const ownerTemplate =
    await repositoryFor(ownerA).getForCurrentUser(templateA);
  assert.deepEqual(ownerTemplate, {
    id: templateA,
    name: 'Synthetic offer',
    category: 'Marketing',
    language: 'pt_BR',
    header_type: 'text',
    header_content: 'Olá {{1}}',
    header_media_url: null,
    body_text: 'Oferta para {{1}}',
    footer_text: 'Fale conosco',
    buttons: [
      { type: 'QUICK_REPLY', text: 'Tenho interesse' },
      {
        type: 'URL',
        text: 'Ver imóvel',
        url: 'https://example.invalid/imovel',
        example: 'https://example.invalid/imovel/123',
      },
      { type: 'PHONE_NUMBER', text: 'Ligar', phone_number: '+5500000000000' },
      { type: 'COPY_CODE', text: 'Copiar', example: 'SYNTHETIC-CODE' },
    ],
    sample_values: { body: ['Ana'], header: ['Ana'] },
  });
  assert.deepEqual(Object.keys(ownerTemplate).sort(), [
    'body_text',
    'buttons',
    'category',
    'footer_text',
    'header_content',
    'header_media_url',
    'header_type',
    'id',
    'language',
    'name',
    'sample_values',
  ]);
  for (const excludedValue of [
    'SYNTHETIC_HEADER_HANDLE_MUST_NOT_LEAK',
    'SYNTHETIC_META_TEMPLATE_ID_MUST_NOT_LEAK',
    'SYNTHETIC_SUBMISSION_ERROR_MUST_NOT_LEAK',
  ]) {
    assert.equal(JSON.stringify(ownerTemplate).includes(excludedValue), false);
  }

  const agentTemplate =
    await repositoryFor(agentA).getForCurrentUser(templateAgentA);
  assert.deepEqual(agentTemplate, {
    id: templateAgentA,
    name: 'Agent template',
    category: 'Utility',
    language: null,
    header_type: null,
    header_content: null,
    header_media_url: null,
    body_text: 'Confirmação',
    footer_text: null,
    buttons: null,
    sample_values: null,
  });

  await expectNotFound(
    () => repositoryFor(viewerA).getForCurrentUser(templateA),
    'same-account different-user isolation'
  );
  await expectNotFound(
    () => repositoryFor(ownerA).getForCurrentUser(templateB),
    'cross-account isolation'
  );
  await expectNotFound(
    () => repositoryFor(ownerA).getForCurrentUser(mismatchedTemplate),
    'creator profile/account mismatch'
  );

  const noSessionRepository = createPostgresTemplateEditorDetailRepository(
    async () => null
  );
  await assert.rejects(
    noSessionRepository.getForCurrentUser(templateA),
    (error) => error instanceof AppError && error.code === 'unauthorized'
  );
  const invalidIdRepository = repositoryFor(ownerA);
  await assert.rejects(
    invalidIdRepository.getForCurrentUser('invalid-id'),
    (error) => error instanceof AppError && error.code === 'bad_request'
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
    'PostgreSQL template-editor detail integration SUCCESS: forced RLS, NOBYPASSRLS, exact minimum column SELECT grants, per-user/account/creator isolation, nullable legacy values, strict button/sample DTO, excluded internal fields, and transaction-local identity cleanup.'
  );
} finally {
  await pool.end();
}
