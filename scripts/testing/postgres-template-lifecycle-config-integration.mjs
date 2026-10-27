import assert from 'node:assert/strict';
import { AppError } from '../../src/lib/db/errors.ts';
import { queryDb } from '../../src/lib/db/postgres-client.ts';
import { getPostgresPool } from '../../src/lib/db/postgres-pool.ts';
import { createPostgresTemplateLifecycleConfigRepository } from '../../src/lib/repositories/template-lifecycle-config.ts';

const viewerA = '00000000-0000-4000-8000-000000000003';
const ownerB = '00000000-0000-4000-8000-000000000002';
const memberC = '00000000-0000-4000-8000-000000000004';
const ownerD = '00000000-0000-4000-8000-000000000005';
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
    {
      role: 'wacrm_template_lifecycle_config_runtime',
      rolbypassrls: false,
    },
  ]);

  const rls = requireSuccess(
    await queryDb(
      'SELECT c.relname, c.relrowsecurity, c.relforcerowsecurity ' +
        'FROM pg_class AS c INNER JOIN pg_namespace AS n ON n.oid = c.relnamespace ' +
        'WHERE n.nspname = $1 AND c.relname = ANY($2::text[]) ORDER BY c.relname',
      ['public', ['accounts', 'profiles', 'whatsapp_config']]
    ),
    'forced RLS probe'
  );
  assert.deepEqual(rls.rows, [
    { relname: 'accounts', relrowsecurity: true, relforcerowsecurity: true },
    { relname: 'profiles', relrowsecurity: true, relforcerowsecurity: true },
    {
      relname: 'whatsapp_config',
      relrowsecurity: true,
      relforcerowsecurity: true,
    },
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
    'whatsapp_config.access_token',
    'whatsapp_config.account_id',
    'whatsapp_config.waba_id',
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
        'WHERE grantee = current_user AND table_schema = $1',
      ['public']
    ),
    'runtime table grant probe'
  );
  assert.deepEqual(tableGrants.rows, []);

  const repositoryFor = (userId) =>
    createPostgresTemplateLifecycleConfigRepository(async () => ({ userId }));
  const viewerRepository = repositoryFor(viewerA);
  assert.deepEqual(await viewerRepository.getForEdit(), {
    encryptedAccessToken: 'SYNTHETIC_CIPHERTEXT_A',
  });
  const editContext = await viewerRepository.getForEdit();
  assert.deepEqual(Object.keys(editContext ?? {}), ['encryptedAccessToken']);
  assert.equal(JSON.stringify(editContext).includes('SYNTHETIC_WABA_A'), false);

  const deleteContext = await viewerRepository.getForDelete();
  assert.deepEqual(deleteContext, {
    encryptedAccessToken: 'SYNTHETIC_CIPHERTEXT_A',
    wabaId: 'SYNTHETIC_WABA_A',
  });
  assert.deepEqual(Object.keys(deleteContext ?? {}).sort(), [
    'encryptedAccessToken',
    'wabaId',
  ]);
  for (const excludedValue of [
    'SYNTHETIC_PHONE_A_MUST_NOT_LEAK',
    'SYNTHETIC_VERIFY_A_MUST_NOT_LEAK',
  ]) {
    assert.equal(JSON.stringify(deleteContext).includes(excludedValue), false);
  }

  assert.deepEqual(await repositoryFor(ownerB).getForDelete(), {
    encryptedAccessToken: 'SYNTHETIC_CIPHERTEXT_B',
    wabaId: 'SYNTHETIC_WABA_B',
  });
  assert.deepEqual(await repositoryFor(memberC).getForDelete(), {
    encryptedAccessToken: 'SYNTHETIC_CIPHERTEXT_C',
    wabaId: null,
  });
  assert.equal(await repositoryFor(ownerD).getForEdit(), null);
  assert.equal(await repositoryFor(ownerD).getForDelete(), null);

  const noSessionRepository = createPostgresTemplateLifecycleConfigRepository(
    async () => null
  );
  await assert.rejects(
    noSessionRepository.getForEdit(),
    (error) => error instanceof AppError && error.code === 'unauthorized'
  );

  const pooledIdentity = requireSuccess(
    await queryDb('SELECT auth.uid()::text AS user_id'),
    'pooled identity reset probe'
  );
  assert.deepEqual(pooledIdentity.rows, [{ user_id: null }]);

  const failClosedConfigs = requireSuccess(
    await queryDb(
      'SELECT count(account_id)::int AS count FROM public.whatsapp_config'
    ),
    'missing identity config RLS probe'
  );
  assert.deepEqual(failClosedConfigs.rows, [{ count: 0 }]);

  console.log(
    'PostgreSQL template lifecycle config integration SUCCESS: forced RLS, NOBYPASSRLS, exact minimum column grants, explicit account scope, opaque credential handling, delete WABA context, null/missing and cross-account behavior, and transaction-local identity cleanup.'
  );
} finally {
  await pool.end();
}
