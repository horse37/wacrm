import assert from 'node:assert/strict';
import { AppError } from '../../src/lib/db/errors.ts';
import { queryDb, withTransaction } from '../../src/lib/db/postgres-client.ts';
import { getPostgresPool } from '../../src/lib/db/postgres-pool.ts';
import { createPostgresTemplateSubmitPersistenceRepository } from '../../src/lib/repositories/template-submit-persistence.ts';

const ownerA = '00000000-0000-4000-8000-000000000001';
const adminA = '00000000-0000-4000-8000-000000000004';
const viewerA = '00000000-0000-4000-8000-000000000003';
const pool = getPostgresPool();
const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const snapshot = (overrides = {}) => ({
  name: 'appointment_reminder',
  category: 'Utility',
  language: 'pt_BR',
  headerType: 'text',
  headerContent: 'Olá {{1}}',
  headerMediaUrl: 'https://synthetic.invalid/new.png',
  headerHandle: 'SYNTHETIC_HANDLE',
  bodyText: 'Sua visita é às {{1}}.',
  footerText: null,
  buttons: [{ type: 'QUICK_REPLY', text: 'Confirmar' }],
  sampleValues: { body: ['amanhã às 10h'], header: ['cliente'] },
  status: 'PENDING',
  metaTemplateId: 'SYNTHETIC_META_TEMPLATE_ID',
  submissionError: null,
  lastSubmittedAt: '2026-10-20T12:00:00.000Z',
  ...overrides,
});

function requireSuccess(result, label) {
  if (!result.ok) throw new Error(`${label} failed with ${result.error.code}`);
  return result.data;
}

function repositoryFor(userId) {
  return createPostgresTemplateSubmitPersistenceRepository(async () => ({
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
    { role: 'wacrm_template_submit_runtime', rolbypassrls: false },
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
      'message_templates.created_at',
      'message_templates.id',
      'message_templates.language',
      'message_templates.name',
      'message_templates.quality_score',
      'message_templates.updated_at',
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
      'message_templates.header_media_url',
      'message_templates.header_type',
      'message_templates.language',
      'message_templates.last_submitted_at',
      'message_templates.meta_template_id',
      'message_templates.name',
      'message_templates.rejection_reason',
      'message_templates.sample_values',
      'message_templates.status',
      'message_templates.submission_error',
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
      'message_templates.header_media_url',
      'message_templates.header_type',
      'message_templates.language',
      'message_templates.last_submitted_at',
      'message_templates.meta_template_id',
      'message_templates.name',
      'message_templates.rejection_reason',
      'message_templates.sample_values',
      'message_templates.status',
      'message_templates.submission_error',
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
        !['header_handle'].includes(row.column_name) ||
        ['INSERT', 'UPDATE'].includes(row.privilege_type)
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

  const ownerRepository = repositoryFor(ownerA);
  const updatedOwner = await ownerRepository.upsertOne(snapshot());
  assert.equal(updatedOwner.id, '30000000-0000-4000-8000-000000000019');
  assert.equal(updatedOwner.action, 'updated');
  assert.ok(Number.isFinite(Date.parse(updatedOwner.createdAt)));
  assert.ok(Number.isFinite(Date.parse(updatedOwner.updatedAt)));
  assert.equal(updatedOwner.qualityScore, 'YELLOW');

  const failedAdminSubmission = await repositoryFor(adminA).upsertOne(
    snapshot({
      status: 'DRAFT',
      metaTemplateId: null,
      submissionError: 'Synthetic provider rejection',
    })
  );
  assert.equal(
    failedAdminSubmission.id,
    '30000000-0000-4000-8000-000000000020'
  );
  assert.equal(failedAdminSubmission.action, 'updated');
  assert.ok(Number.isFinite(Date.parse(failedAdminSubmission.createdAt)));
  assert.ok(Number.isFinite(Date.parse(failedAdminSubmission.updatedAt)));
  assert.equal(failedAdminSubmission.qualityScore, null);

  const accountScopedInsert = await ownerRepository.upsertOne(
    snapshot({
      name: 'account_b_only',
      bodyText: 'Novo registro sintético',
      sampleValues: { header: ['cliente'] },
    })
  );
  assert.equal(accountScopedInsert.action, 'inserted');
  assert.match(accountScopedInsert.id, uuidPattern);
  assert.ok(Number.isFinite(Date.parse(accountScopedInsert.createdAt)));
  assert.ok(Number.isFinite(Date.parse(accountScopedInsert.updatedAt)));
  assert.equal(accountScopedInsert.qualityScore, null);

  const orphanCreatorInsert = await ownerRepository.upsertOne(
    snapshot({
      name: 'orphan_submit',
      bodyText: 'Criador válido sintético',
      sampleValues: { header: ['cliente'] },
    })
  );
  assert.equal(orphanCreatorInsert.action, 'inserted');
  assert.match(orphanCreatorInsert.id, uuidPattern);

  const concurrentSnapshot = snapshot({ name: 'concurrent_submit' });
  const concurrentResults = await Promise.all([
    ownerRepository.upsertOne(concurrentSnapshot),
    ownerRepository.upsertOne(concurrentSnapshot),
  ]);
  assert.deepEqual(concurrentResults.map((result) => result.action).sort(), [
    'inserted',
    'updated',
  ]);
  assert.equal(concurrentResults[0].id, concurrentResults[1].id);

  await assert.rejects(
    repositoryFor(viewerA).upsertOne(snapshot({ name: 'viewer_write' })),
    (error) => error instanceof AppError && error.code === 'forbidden'
  );
  await assert.rejects(
    createPostgresTemplateSubmitPersistenceRepository(
      async () => null
    ).upsertOne(snapshot({ name: 'unauthenticated_write' })),
    (error) => error instanceof AppError && error.code === 'unauthorized'
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
    'PostgreSQL template submit persistence integration SUCCESS: forced RLS, NOBYPASSRLS, exact minimum SELECT/INSERT/UPDATE grants including row metadata, per-user unique semantics within a shared account, account/creator isolation, persisted timestamp and quality-score results, success and DRAFT-error outcomes, constraint rollback, concurrent same-key idempotency, and transaction-local identity cleanup.'
  );
} finally {
  await pool.end();
}
