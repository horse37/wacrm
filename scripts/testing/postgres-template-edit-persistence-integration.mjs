import assert from 'node:assert/strict';
import { withTransaction } from '../../src/lib/db/postgres-client.ts';
import { getPostgresPool } from '../../src/lib/db/postgres-pool.ts';
import { createDefaultPostgresAccountGuards } from '../../src/lib/auth/postgres-account-guard.ts';
import { createPostgresTemplateEditPersistenceRepository } from '../../src/lib/repositories/template-edit-persistence.ts';
import { createPostgresTemplateLifecycleConfigRepository } from '../../src/lib/repositories/template-lifecycle-config.ts';
import { createPostgresTemplateLifecycleContextRepository } from '../../src/lib/repositories/template-lifecycle-context.ts';

const databaseName = 'wacrm_template_edit_task';
const ids = {
  accountA: '00000000-0000-4000-8000-000000000001',
  accountB: '00000000-0000-4000-8000-000000000002',
  adminA: '00000000-0000-4000-8000-000000000011',
  viewerA: '00000000-0000-4000-8000-000000000012',
  templateA: '30000000-0000-4000-8000-000000000031',
  templateB: '30000000-0000-4000-8000-000000000032',
};
const payload = {
  name: 'requested_name_not_persisted',
  category: 'Marketing',
  language: 'en_US',
  header_type: 'text',
  header_content: 'Olá {{1}}',
  header_media_url: 'https://synthetic.invalid/new.png',
  header_handle: 'SYNTHETIC_HANDLE',
  body_text: 'Sua visita é às {{1}}.',
  footer_text: null,
  buttons: [{ type: 'QUICK_REPLY', text: 'Confirmar' }],
  sample_values: { body: ['amanhã às 10h'], header: ['cliente'] },
};
const pool = getPostgresPool();

async function rows(sql, values = []) {
  const result = await withTransaction(async (transaction) => {
    await transaction.query(
      "SELECT set_config('request.jwt.claim.sub', $1, true)",
      [ids.adminA]
    );
    return transaction.query(sql, values);
  });
  if (!result.ok)
    throw new Error('Synthetic PostgreSQL query failed: ' + result.error.code);
  return result.data.rows;
}

function repositoryFor(userId) {
  return createPostgresTemplateEditPersistenceRepository(async () => ({
    userId,
  }));
}

async function main() {
  if (process.env.WACRM_TEMPLATE_EDIT_POSTGRES_TEST !== '1') {
    throw new Error('Disposable PostgreSQL opt-in flag is required.');
  }
  const databaseUrl = new URL(process.env.DATABASE_URL ?? '');
  if (
    databaseUrl.protocol !== 'postgres:' ||
    databaseUrl.hostname !== '127.0.0.1' ||
    databaseUrl.port !== '5432' ||
    databaseUrl.pathname !== '/' + databaseName ||
    databaseUrl.username !== 'wacrm_template_edit_runtime'
  ) {
    throw new Error('Refusing a non-disposable PostgreSQL target.');
  }

  const runtime = await rows(
    'SELECT current_user AS role, rolbypassrls FROM pg_roles WHERE rolname = current_user'
  );
  assert.deepEqual(runtime, [
    { role: 'wacrm_template_edit_runtime', rolbypassrls: false },
  ]);
  const rls = await rows(
    `SELECT c.relname, c.relrowsecurity, c.relforcerowsecurity
     FROM pg_class AS c
     INNER JOIN pg_namespace AS n ON n.oid = c.relnamespace
     WHERE n.nspname = 'public'
       AND c.relname = ANY($1::text[])
     ORDER BY c.relname`,
    [['accounts', 'message_templates', 'profiles', 'whatsapp_config']]
  );
  assert.deepEqual(
    rls,
    ['accounts', 'message_templates', 'profiles', 'whatsapp_config'].map(
      (relname) => ({
        relname,
        relrowsecurity: true,
        relforcerowsecurity: true,
      })
    )
  );

  const adminSession = async () => ({ userId: ids.adminA });
  const guards = createDefaultPostgresAccountGuards(adminSession);
  assert.deepEqual(await guards.requireRole('admin'), {
    userId: ids.adminA,
    accountId: ids.accountA,
    role: 'admin',
    account: { id: ids.accountA, name: 'Synthetic Account A' },
  });

  const contextRepository =
    createPostgresTemplateLifecycleContextRepository(adminSession);
  assert.deepEqual(await contextRepository.getForEdit(ids.templateA), {
    status: 'APPROVED',
    metaTemplateId: 'SYNTHETIC_META_ID_A',
  });
  assert.equal(await contextRepository.getForEdit(ids.templateB), null);
  const configRepository =
    createPostgresTemplateLifecycleConfigRepository(adminSession);
  assert.deepEqual(await configRepository.getForEdit(), {
    encryptedAccessToken: 'synthetic-encrypted-token-A',
  });

  const adminRepository = repositoryFor(ids.adminA);
  const failureAt = '2026-10-20T12:00:00.000Z';
  await adminRepository.persist({
    templateId: ids.templateA,
    lastSubmittedAt: failureAt,
    outcome: { kind: 'provider_failure', error: 'Synthetic Meta rejection' },
  });
  let [template] = await rows(
    `SELECT category, status, body_text, submission_error, rejection_reason,
            last_submitted_at, meta_template_id, name, language
     FROM public.message_templates WHERE id = $1`,
    [ids.templateA]
  );
  assert.equal(template.category, 'Utility');
  assert.equal(template.status, 'APPROVED');
  assert.equal(template.body_text, 'Original body {{1}}.');
  assert.equal(template.submission_error, 'Synthetic Meta rejection');
  assert.equal(template.rejection_reason, 'Previous synthetic rejection');
  assert.equal(Date.parse(template.last_submitted_at), Date.parse(failureAt));

  const successAt = '2026-10-20T12:30:00.000Z';
  const result = await adminRepository.persist({
    templateId: ids.templateA,
    lastSubmittedAt: successAt,
    outcome: { kind: 'provider_success', payload },
  });
  assert.equal(result.template.name, 'appointment_reminder');
  assert.equal(result.template.language, 'pt_BR');
  assert.equal(result.template.status, 'PENDING');
  assert.deepEqual(Object.keys(result.template).sort(), [
    'account_id',
    'body_text',
    'buttons',
    'category',
    'created_at',
    'footer_text',
    'header_content',
    'header_handle',
    'header_media_url',
    'header_type',
    'id',
    'language',
    'last_submitted_at',
    'meta_template_id',
    'name',
    'quality_score',
    'rejection_reason',
    'sample_values',
    'status',
    'submission_error',
    'updated_at',
    'user_id',
  ]);
  [template] = await rows(
    `SELECT category, status, header_content, header_media_url, header_handle,
            body_text, buttons, sample_values, submission_error, rejection_reason,
            last_submitted_at, meta_template_id, name, language
     FROM public.message_templates WHERE id = $1`,
    [ids.templateA]
  );
  assert.equal(template.category, 'Marketing');
  assert.equal(template.status, 'PENDING');
  assert.equal(template.header_content, payload.header_content);
  assert.equal(template.header_media_url, payload.header_media_url);
  assert.equal(template.header_handle, payload.header_handle);
  assert.equal(template.body_text, payload.body_text);
  assert.deepEqual(template.buttons, payload.buttons);
  assert.deepEqual(template.sample_values, payload.sample_values);
  assert.equal(template.submission_error, null);
  assert.equal(template.rejection_reason, null);
  assert.equal(Date.parse(template.last_submitted_at), Date.parse(successAt));
  assert.equal(template.meta_template_id, 'SYNTHETIC_META_ID_A');
  assert.equal(template.name, 'appointment_reminder');
  assert.equal(template.language, 'pt_BR');

  await assert.rejects(
    repositoryFor(ids.viewerA).persist({
      templateId: ids.templateA,
      lastSubmittedAt: successAt,
      outcome: { kind: 'provider_success', payload },
    }),
    (error) => error?.code === 'forbidden'
  );
  await assert.rejects(
    adminRepository.persist({
      templateId: ids.templateB,
      lastSubmittedAt: successAt,
      outcome: { kind: 'provider_success', payload },
    }),
    (error) => error?.code === 'not_found'
  );
  console.log(
    'PASS: forced-RLS PostgreSQL edit reads, success and provider-rejection writes, role and account isolation.'
  );
}

try {
  await main();
} finally {
  await pool.end();
}
