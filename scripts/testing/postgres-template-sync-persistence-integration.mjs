import assert from 'node:assert/strict';
import { AppError } from '../../src/lib/db/errors.ts';
import { queryDb, withTransaction } from '../../src/lib/db/postgres-client.ts';
import { getPostgresPool } from '../../src/lib/db/postgres-pool.ts';
import { createPostgresTemplateSyncPersistenceRepository } from '../../src/lib/repositories/template-sync-persistence.ts';

const ownerA = '00000000-0000-4000-8000-000000000001';
const viewerA = '00000000-0000-4000-8000-000000000003';
const pool = getPostgresPool();
const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const snapshot = (overrides = {}) => ({
  name: 'Appointment reminder',
  category: 'Utility',
  language: 'pt_BR',
  headerType: 'text',
  headerContent: 'Olá {{1}}',
  headerHandle: 'SYNTHETIC_HANDLE',
  bodyText: 'Sua visita é às {{1}}.',
  footerText: null,
  buttons: [{ type: 'QUICK_REPLY', text: 'Confirmar' }],
  sampleValues: { body: ['amanhã às 10h'] },
  status: 'APPROVED',
  metaTemplateId: 'SYNTHETIC_META_TEMPLATE_ID',
  qualityScore: 'GREEN',
  updatedAt: '2026-10-20T12:00:00.000Z',
  ...overrides,
});

function requireSuccess(result, label) {
  if (!result.ok) throw new Error(`${label} failed with ${result.error.code}`);
  return result.data;
}

function repositoryFor(userId) {
  return createPostgresTemplateSyncPersistenceRepository(async () => ({
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
    { role: 'wacrm_template_sync_persist_runtime', rolbypassrls: false },
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
       ORDER BY privilege_type, table_name, column_name`
    ),
    'runtime column grant probe'
  );
  const expectedGrants = [
    ...[
      'accounts.id',
      'accounts.name',
      'profiles.account_id',
      'profiles.account_role',
      'profiles.user_id',
      'message_templates.account_id',
      'message_templates.id',
      'message_templates.language',
      'message_templates.name',
      'message_templates.user_id',
    ].map((column) => `SELECT:${column}`),
    ...[
      'message_templates.account_id',
      'message_templates.body_text',
      'message_templates.buttons',
      'message_templates.category',
      'message_templates.footer_text',
      'message_templates.header_content',
      'message_templates.header_handle',
      'message_templates.header_type',
      'message_templates.language',
      'message_templates.meta_template_id',
      'message_templates.name',
      'message_templates.quality_score',
      'message_templates.sample_values',
      'message_templates.status',
      'message_templates.updated_at',
      'message_templates.user_id',
    ].map((column) => `INSERT:${column}`),
    ...[
      'message_templates.account_id',
      'message_templates.body_text',
      'message_templates.buttons',
      'message_templates.category',
      'message_templates.footer_text',
      'message_templates.header_content',
      'message_templates.header_handle',
      'message_templates.header_type',
      'message_templates.language',
      'message_templates.meta_template_id',
      'message_templates.name',
      'message_templates.quality_score',
      'message_templates.sample_values',
      'message_templates.status',
      'message_templates.updated_at',
      'message_templates.user_id',
    ].map((column) => `UPDATE:${column}`),
  ].sort();
  assert.deepEqual(
    grants.rows
      .map(
        (row) => `${row.privilege_type}:${row.table_name}.${row.column_name}`
      )
      .sort(),
    expectedGrants
  );
  assert.ok(
    grants.rows.every(
      (row) =>
        row.table_name !== 'message_templates' ||
        !['header_media_url', 'rejection_reason', 'submission_error'].includes(
          row.column_name
        )
    )
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
  assert.deepEqual(tableGrants.rows, []);

  const repository = repositoryFor(ownerA);
  const updated = await repository.upsertOne(snapshot());
  assert.deepEqual(updated, {
    id: '30000000-0000-4000-8000-000000000009',
    action: 'updated',
  });

  const accountScopedInsert = await repository.upsertOne(
    snapshot({ name: 'Account B only', bodyText: 'Novo registro sintético' })
  );
  assert.equal(accountScopedInsert.action, 'inserted');
  assert.match(accountScopedInsert.id, uuidPattern);

  const orphanCreatorInsert = await repository.upsertOne(
    snapshot({ name: 'Orphan match', bodyText: 'Recriado com criador válido' })
  );
  assert.equal(orphanCreatorInsert.action, 'inserted');
  assert.match(orphanCreatorInsert.id, uuidPattern);

  const concurrentSnapshot = snapshot({ name: 'Concurrent generated' });
  const concurrentResults = await Promise.all([
    repository.upsertOne(concurrentSnapshot),
    repository.upsertOne(concurrentSnapshot),
  ]);
  assert.deepEqual(concurrentResults.map((result) => result.action).sort(), [
    'inserted',
    'updated',
  ]);
  assert.equal(concurrentResults[0].id, concurrentResults[1].id);

  await assert.rejects(
    repository.upsertOne(snapshot({ name: 'Duplicate A', language: 'en_US' })),
    (error) => error instanceof AppError && error.code === 'conflict'
  );
  await assert.rejects(
    repositoryFor(viewerA).upsertOne(snapshot({ name: 'Viewer write' })),
    (error) => error instanceof AppError && error.code === 'forbidden'
  );
  await assert.rejects(
    createPostgresTemplateSyncPersistenceRepository(async () => null).upsertOne(
      snapshot({ name: 'Unauthenticated write' })
    ),
    (error) => error instanceof AppError && error.code === 'unauthorized'
  );
  await assert.rejects(
    repository.upsertOne(
      snapshot({ name: 'Invalid input', buttons: [{ type: 'BAD' }] })
    ),
    (error) => error instanceof AppError && error.code === 'bad_request'
  );

  const constraintResult = await withTransaction(async (transaction) => {
    await transaction.query(
      "SELECT set_config('request.jwt.claim.sub', $1, true)",
      [ownerA]
    );
    await transaction.query(
      `INSERT INTO public.message_templates (
         account_id, user_id, name, category, language, body_text, status
       ) VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [
        '10000000-0000-4000-8000-000000000001',
        ownerA,
        'Constraint probe',
        'Utility',
        'pt_BR',
        'Synthetic body',
        'INVALID_STATUS',
      ]
    );
  });
  assert.equal(constraintResult.ok, false);
  if (!constraintResult.ok)
    assert.equal(constraintResult.error.code, 'db_error');

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
    'PostgreSQL template sync persistence integration SUCCESS: forced RLS, NOBYPASSRLS, exact minimum SELECT/INSERT/UPDATE grants, account/creator-scoped insert/update, paused-state match, duplicate fail-closed behavior, database constraints, transaction advisory lock concurrency, and transaction-local identity cleanup.'
  );
} finally {
  await pool.end();
}
