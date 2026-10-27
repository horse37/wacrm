import assert from 'node:assert/strict';
import { AppError } from '../../src/lib/db/errors.ts';
import { queryDb } from '../../src/lib/db/postgres-client.ts';
import { getPostgresPool } from '../../src/lib/db/postgres-pool.ts';
import { createPostgresTemplateLifecycleContextRepository } from '../../src/lib/repositories/template-lifecycle-context.ts';

const ownerA = '00000000-0000-4000-8000-000000000001';
const viewerA = '00000000-0000-4000-8000-000000000003';
const ownerB = '00000000-0000-4000-8000-000000000002';
const pool = getPostgresPool();

function requireSuccess(result, label) {
  if (!result.ok) throw new Error(label + ' failed with ' + result.error.code);
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
    { role: 'wacrm_template_lifecycle_runtime', rolbypassrls: false },
  ]);

  const rls = requireSuccess(
    await queryDb(
      'SELECT c.relname, c.relrowsecurity, c.relforcerowsecurity ' +
        'FROM pg_class AS c INNER JOIN pg_namespace AS n ON n.oid = c.relnamespace ' +
        'WHERE n.nspname = $1 AND c.relname = ANY($2::text[]) ORDER BY c.relname',
      ['public', ['accounts', 'profiles', 'message_templates']]
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
      'SELECT table_name, column_name, privilege_type ' +
        'FROM information_schema.role_column_grants ' +
        'WHERE grantee = current_user AND table_schema = $1 ' +
        'ORDER BY table_name, column_name',
      ['public']
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
    'message_templates.meta_template_id',
    'message_templates.name',
    'message_templates.status',
    'message_templates.user_id',
  ].sort();
  assert.deepEqual(
    grants.rows.map((row) => row.table_name + '.' + row.column_name),
    expectedColumns
  );
  assert.ok(grants.rows.every((row) => row.privilege_type === 'SELECT'));

  const tableGrants = requireSuccess(
    await queryDb(
      'SELECT table_name, privilege_type ' +
        'FROM information_schema.role_table_grants ' +
        'WHERE grantee = current_user AND table_schema = $1 ' +
        'ORDER BY table_name, privilege_type',
      ['public']
    ),
    'runtime table grant probe'
  );
  assert.deepEqual(tableGrants.rows, []);

  const repositoryFor = (userId) =>
    createPostgresTemplateLifecycleContextRepository(async () => ({ userId }));
  const viewerRepository = repositoryFor(viewerA);
  const editContext = await viewerRepository.getForEdit(
    '30000000-0000-4000-8000-000000000009'
  );
  assert.deepEqual(editContext, {
    status: 'PAUSED',
    metaTemplateId: 'SYNTHETIC_META_LIFECYCLE_009',
  });
  assert.deepEqual(Object.keys(editContext).sort(), [
    'metaTemplateId',
    'status',
  ]);

  const deleteContext = await viewerRepository.getForDelete(
    '30000000-0000-4000-8000-000000000009'
  );
  assert.deepEqual(deleteContext, {
    name: 'Lifecycle shared',
    metaTemplateId: 'SYNTHETIC_META_LIFECYCLE_009',
  });
  assert.deepEqual(Object.keys(deleteContext).sort(), [
    'metaTemplateId',
    'name',
  ]);

  const localDraft = '30000000-0000-4000-8000-000000000008';
  assert.deepEqual(await viewerRepository.getForEdit(localDraft), {
    status: 'DRAFT',
    metaTemplateId: null,
  });
  assert.deepEqual(await viewerRepository.getForDelete(localDraft), {
    name: 'Local draft',
    metaTemplateId: null,
  });

  for (const hiddenTemplate of [
    '30000000-0000-4000-8000-000000000007',
    '30000000-0000-4000-8000-000000000006',
    '30000000-0000-4000-8000-000000000005',
    '39999999-0000-4000-8000-000000000001',
  ]) {
    assert.equal(await viewerRepository.getForEdit(hiddenTemplate), null);
    assert.equal(await viewerRepository.getForDelete(hiddenTemplate), null);
  }

  assert.deepEqual(await repositoryFor(ownerA).getForEdit(localDraft), {
    status: 'DRAFT',
    metaTemplateId: null,
  });
  assert.equal(
    await repositoryFor(ownerB).getForEdit(
      '30000000-0000-4000-8000-000000000009'
    ),
    null
  );

  const noSessionRepository = createPostgresTemplateLifecycleContextRepository(
    async () => null
  );
  await assert.rejects(
    noSessionRepository.getForEdit(localDraft),
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
    'PostgreSQL template lifecycle context integration SUCCESS: forced RLS, NOBYPASSRLS, exact minimum column grants, account/template predicates, creator consistency, minimal edit/delete projections, null/missing and cross-account behavior, and transaction-local identity cleanup.'
  );
} finally {
  await pool.end();
}
