import assert from 'node:assert/strict';
import { AppError } from '../../src/lib/db/errors.ts';
import { queryDb } from '../../src/lib/db/postgres-client.ts';
import { getPostgresPool } from '../../src/lib/db/postgres-pool.ts';
import { createPostgresTemplateSendDefinitionRepository } from '../../src/lib/repositories/template-send-definition.ts';

const ownerA = '00000000-0000-4000-8000-000000000001';
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
    { role: 'wacrm_template_send_runtime', rolbypassrls: false },
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
    'message_templates.created_at',
    'message_templates.header_content',
    'message_templates.header_media_url',
    'message_templates.header_type',
    'message_templates.id',
    'message_templates.language',
    'message_templates.name',
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
    createPostgresTemplateSendDefinitionRepository(async () => ({ userId }));
  const viewerRepository = repositoryFor(viewerA);
  const definition = await viewerRepository.findForCurrentAccount({
    name: 'Appointment reminder',
  });
  assert.deepEqual(definition, {
    id: '30000000-0000-4000-8000-000000000009',
    user_id: viewerA,
    name: 'Appointment reminder',
    category: 'Utility',
    body_text: 'Your visit is at {{1}}.',
    created_at: '2026-10-20 12:00:00+00',
    header_type: 'text',
    header_content: 'Hello {{1}}',
    buttons: [
      {
        type: 'URL',
        text: 'Open listing',
        url: 'https://example.test/{{1}}',
      },
      { type: 'QUICK_REPLY', text: 'Confirm' },
    ],
  });
  assert.deepEqual(Object.keys(definition).sort(), [
    'body_text',
    'buttons',
    'category',
    'created_at',
    'header_content',
    'header_type',
    'id',
    'name',
    'user_id',
  ]);
  for (const excludedValue of [
    'SYNTHETIC_HEADER_HANDLE_MUST_NOT_LEAK',
    'SYNTHETIC_SAMPLE_MUST_NOT_LEAK',
    'SYNTHETIC_META_ID_MUST_NOT_LEAK',
    'SYNTHETIC_REJECTION_MUST_NOT_LEAK',
    'SYNTHETIC_SUBMISSION_ERROR_MUST_NOT_LEAK',
  ]) {
    assert.equal(JSON.stringify(definition).includes(excludedValue), false);
  }

  assert.equal(
    await viewerRepository.findForCurrentAccount({ name: 'Missing template' }),
    null
  );
  assert.equal(
    await viewerRepository.findForCurrentAccount({ name: 'Orphan definition' }),
    null
  );
  await assert.rejects(
    viewerRepository.findForCurrentAccount({ name: 'Shared name' }),
    (error) => error instanceof AppError && error.code === 'conflict'
  );

  const pendingDefinition = await viewerRepository.findForCurrentAccount({
    name: 'Pending legacy',
  });
  assert.equal(pendingDefinition?.body_text, 'Pending legacy body.');

  assert.equal(
    (
      await repositoryFor(ownerA).findForCurrentAccount({
        name: 'Owner only',
        language: 'pt_BR',
      })
    )?.body_text,
    'Account A owner template.'
  );
  assert.equal(
    (
      await repositoryFor(ownerB).findForCurrentAccount({
        name: 'Account B only',
      })
    )?.body_text,
    'Account B template.'
  );

  const noSessionRepository = createPostgresTemplateSendDefinitionRepository(
    async () => null
  );
  await assert.rejects(
    noSessionRepository.findForCurrentAccount({ name: 'Appointment reminder' }),
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
    'PostgreSQL template-send definition integration SUCCESS: forced RLS, NOBYPASSRLS, exact minimum column grants, account/name/language predicates, creator consistency, default language, null/missing and ambiguous handling, minimal send DTO, and transaction-local identity cleanup.'
  );
} finally {
  await pool.end();
}
