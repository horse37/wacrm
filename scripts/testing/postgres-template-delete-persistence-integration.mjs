import assert from 'node:assert/strict';
import { AppError } from '../../src/lib/db/errors.ts';
import { queryDb } from '../../src/lib/db/postgres-client.ts';
import { getPostgresPool } from '../../src/lib/db/postgres-pool.ts';
import { createPostgresTemplateDeletePersistenceRepository } from '../../src/lib/repositories/template-delete-persistence.ts';

const ownerA = '00000000-0000-4000-8000-000000000001';
const adminA = '00000000-0000-4000-8000-000000000004';
const agentA = '00000000-0000-4000-8000-000000000003';
const templateId = '30000000-0000-4000-8000-000000000001';
const ownerTemplateId = '30000000-0000-4000-8000-000000000002';
const concurrentTemplateId = '30000000-0000-4000-8000-000000000003';
const crossAccountTemplateId = '30000000-0000-4000-8000-000000000004';
const orphanTemplateId = '30000000-0000-4000-8000-000000000005';
const pool = getPostgresPool();

function requireSuccess(result, label) {
  if (!result.ok) throw new Error(`${label} failed with ${result.error.code}`);
  return result.data;
}

function repositoryFor(userId) {
  return createPostgresTemplateDeletePersistenceRepository(async () => ({
    userId,
  }));
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
    { role: 'wacrm_template_delete_runtime', rolbypassrls: false },
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

  const columnGrants = requireSuccess(
    await queryDb(
      `SELECT table_name, column_name, privilege_type
       FROM information_schema.role_column_grants
       WHERE grantee = current_user AND table_schema = 'public'
       ORDER BY privilege_type, table_name, column_name`
    ),
    'runtime column grant probe'
  );
  const expectedColumnGrants = [
    'SELECT:accounts.id',
    'SELECT:accounts.name',
    'SELECT:message_templates.account_id',
    'SELECT:message_templates.id',
    'SELECT:message_templates.user_id',
    'SELECT:profiles.account_id',
    'SELECT:profiles.account_role',
    'SELECT:profiles.user_id',
  ].sort();
  assert.deepEqual(
    columnGrants.rows
      .map(
        (row) => `${row.privilege_type}:${row.table_name}.${row.column_name}`
      )
      .sort(),
    expectedColumnGrants
  );

  const tableGrants = requireSuccess(
    await queryDb(
      `SELECT table_name, privilege_type
       FROM information_schema.role_table_grants
       WHERE grantee = current_user AND table_schema = 'public'
       ORDER BY table_name, privilege_type`
    ),
    'runtime table grant probe'
  );
  assert.deepEqual(tableGrants.rows, [
    { table_name: 'message_templates', privilege_type: 'DELETE' },
  ]);

  await assert.rejects(
    createPostgresTemplateDeletePersistenceRepository(
      async () => null
    ).deleteTemplate(templateId),
    (error) => error instanceof AppError && error.code === 'unauthorized'
  );
  await assert.rejects(
    repositoryFor(agentA).deleteTemplate(templateId),
    (error) => error instanceof AppError && error.code === 'forbidden'
  );
  await assert.rejects(
    repositoryFor(adminA).deleteTemplate('../invalid-template-id'),
    (error) => error instanceof AppError && error.code === 'bad_request'
  );
  await assert.rejects(
    repositoryFor(adminA).deleteTemplate(crossAccountTemplateId),
    (error) => error instanceof AppError && error.code === 'not_found'
  );
  await assert.rejects(
    repositoryFor(adminA).deleteTemplate(orphanTemplateId),
    (error) => error instanceof AppError && error.code === 'not_found'
  );

  await repositoryFor(adminA).deleteTemplate(templateId);
  await repositoryFor(ownerA).deleteTemplate(ownerTemplateId);

  const concurrent = await Promise.allSettled([
    repositoryFor(adminA).deleteTemplate(concurrentTemplateId),
    repositoryFor(ownerA).deleteTemplate(concurrentTemplateId),
  ]);
  assert.equal(
    concurrent.filter((result) => result.status === 'fulfilled').length,
    1
  );
  const rejected = concurrent.find((result) => result.status === 'rejected');
  assert.equal(rejected?.reason instanceof AppError, true);
  assert.equal(rejected.reason.code, 'not_found');

  const pooledIdentity = requireSuccess(
    await queryDb('SELECT auth.uid()::text AS user_id'),
    'pooled identity reset probe'
  );
  assert.deepEqual(pooledIdentity.rows, [{ user_id: null }]);
  const noIdentity = requireSuccess(
    await queryDb(
      'SELECT count(id)::int AS count FROM public.message_templates'
    ),
    'missing identity RLS probe'
  );
  assert.deepEqual(noIdentity.rows, [{ count: 0 }]);

  console.log(
    'PostgreSQL template delete persistence integration SUCCESS: forced RLS, NOBYPASSRLS, exact minimum grants, admin/owner authorization, account and creator isolation, not-found behavior, concurrent deletes, and transaction-local identity cleanup.'
  );
} finally {
  await pool.end();
}
