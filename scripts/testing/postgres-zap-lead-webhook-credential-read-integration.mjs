import assert from 'node:assert/strict';
import { queryDb, withTransaction } from '../../src/lib/db/postgres-client.ts';
import { getPostgresPool } from '../../src/lib/db/postgres-pool.ts';
import { createPostgresZapLeadEventStreamReadRepository } from '../../src/lib/repositories/zap-lead-event-stream-read.ts';
import { createPostgresZapLeadRegistrationReadRepository } from '../../src/lib/repositories/zap-lead-registration-read.ts';
import { lookupZapLeadWebhookCredential } from '../../src/lib/repositories/zap-lead-webhook-credential-read.ts';

const keyIdA = 'ak_aaaaaaaaaaaaaaaaaaaaaaaa';
const keyIdB = 'ak_bbbbbbbbbbbbbbbbbbbbbbbb';
const userIdA = '00000000-0000-4000-8000-000000000001';
const viewerIdA = '00000000-0000-4000-8000-000000000002';
const userIdB = '00000000-0000-4000-8000-000000000003';
const accountIdA = '10000000-0000-4000-8000-000000000001';
const accountIdB = '10000000-0000-4000-8000-000000000002';
const keySetting = 'app.wacrm_zap_lead_webhook_key_id';
const cursorA = '18fae01a-a5b8-4a7e-95af-453810e49dc9';
const pool = getPostgresPool();

function requireSuccess(result, label) {
  if (!result.ok) throw new Error(`${label} failed with ${result.error.code}`);
  return result.data;
}

try {
  const identity = requireSuccess(
    await queryDb(
      `SELECT current_user AS role, rolcanlogin AS can_login,
              rolsuper AS is_superuser, rolbypassrls AS bypasses_rls
       FROM pg_roles WHERE rolname = current_user`
    ),
    'runtime identity probe'
  );
  assert.deepEqual(identity.rows, [
    {
      role: 'wacrm_runtime',
      can_login: true,
      is_superuser: false,
      bypasses_rls: false,
    },
  ]);

  const relation = requireSuccess(
    await queryDb(
      `SELECT relation.relrowsecurity, relation.relforcerowsecurity,
              owner.rolname AS owner_name, owner.rolcanlogin AS owner_can_login,
              owner.rolsuper AS owner_is_superuser,
              owner.rolbypassrls AS owner_bypasses_rls
       FROM pg_class AS relation
       JOIN pg_roles AS owner ON owner.oid = relation.relowner
       WHERE relation.oid = 'public.zap_lead_integrations'::regclass`
    ),
    'forced RLS and table owner probe'
  );
  assert.deepEqual(relation.rows, [
    {
      relrowsecurity: true,
      relforcerowsecurity: true,
      owner_name: 'postgres',
      owner_can_login: false,
      owner_is_superuser: false,
      owner_bypasses_rls: false,
    },
  ]);

  const grants = requireSuccess(
    await queryDb(
      `SELECT has_table_privilege('wacrm_runtime',
                 'public.zap_lead_integrations', 'SELECT') AS table_select,
              has_table_privilege('wacrm_runtime',
                 'public.zap_lead_integrations', 'INSERT') AS table_insert,
              has_table_privilege('wacrm_runtime',
                 'public.zap_lead_integrations', 'UPDATE') AS table_update,
              has_table_privilege('wacrm_runtime',
                 'public.zap_lead_integrations', 'DELETE') AS table_delete,
              has_column_privilege('wacrm_runtime',
                 'public.zap_lead_integrations', 'key_id', 'SELECT') AS key_select,
              has_column_privilege('wacrm_runtime',
                 'public.zap_lead_integrations', 'account_id', 'SELECT')
                 AS account_select,
              has_column_privilege('wacrm_runtime',
                 'public.zap_lead_integrations', 'encrypted_registration',
                 'SELECT') AS ciphertext_select,
              has_column_privilege('wacrm_runtime',
                 'public.zap_lead_integrations', 'api_base_url', 'SELECT')
                 AS api_url_select,
has_column_privilege('wacrm_runtime',
'public.zap_lead_integrations', 'created_at', 'SELECT')
AS created_at_select,
              to_regprocedure(
                 'public.get_zap_lead_webhook_credential(text)') IS NULL
                 AS no_definer_function,
              pg_catalog.pg_has_role('wacrm_runtime', 'service_role', 'MEMBER')
                 AS service_role_member,
              pg_catalog.pg_has_role('wacrm_runtime', 'wacrm_job', 'MEMBER')
                 AS job_role_member,
              pg_catalog.pg_has_role('wacrm_runtime', 'wacrm_migrator', 'MEMBER')
                 AS migrator_role_member`
    ),
    'column privilege probe'
  );
  assert.deepEqual(grants.rows, [
    {
      table_select: false,
      table_insert: false,
      table_update: false,
      table_delete: false,
      key_select: true,
      account_select: true,
      ciphertext_select: true,
      api_url_select: true,
      created_at_select: false,
      no_definer_function: true,
      service_role_member: false,
      job_role_member: false,
      migrator_role_member: false,
    },
  ]);

  const unscopedRead = requireSuccess(
    await queryDb(
      'SELECT account_id, encrypted_registration FROM public.zap_lead_integrations'
    ),
    'unscoped runtime read'
  );
  assert.deepEqual(unscopedRead.rows, []);

  const sharedRuntimeApiUrlRead = requireSuccess(
    await withTransaction(async (transaction) => {
      await transaction.query(
        "SELECT pg_catalog.set_config('app.wacrm_zap_lead_webhook_key_id', $1, true)",
        [keyIdA]
      );
      return transaction.query(
        'SELECT api_base_url FROM public.zap_lead_integrations WHERE key_id = $1',
        [keyIdA]
      );
    }),
    'shared runtime api_base_url read'
  );
  assert.deepEqual(sharedRuntimeApiUrlRead.rows, [
    { api_base_url: 'https://synthetic-a.example.test' },
  ]);

  const restrictedMetadataRead = await queryDb(
    'SELECT created_at FROM public.zap_lead_integrations WHERE key_id = $1',
    [keyIdA]
  );
  assert.equal(restrictedMetadataRead.ok, false);
  if (!restrictedMetadataRead.ok) {
    assert.equal(restrictedMetadataRead.error.sqlState, '42501');
  }

  const wrongScope = requireSuccess(
    await withTransaction(async (transaction) => {
      await transaction.query(
        "SELECT pg_catalog.set_config('app.wacrm_zap_lead_webhook_key_id', $1, true)",
        [keyIdA]
      );
      return transaction.query(
        'SELECT account_id FROM public.zap_lead_integrations WHERE key_id = $1',
        [keyIdB]
      );
    }),
    'cross-key RLS probe'
  );
  assert.deepEqual(wrongScope.rows, []);

  assert.deepEqual(await lookupZapLeadWebhookCredential(keyIdA), {
    accountId: accountIdA,
    encryptedRegistration: 'synthetic-encrypted-registration-a',
  });
  assert.deepEqual(await lookupZapLeadWebhookCredential(keyIdB), {
    accountId: accountIdB,
    encryptedRegistration: 'synthetic-encrypted-registration-b',
  });
  assert.equal(
    await lookupZapLeadWebhookCredential('ak_cccccccccccccccccccccccc'),
    null
  );

  const registrationA = createPostgresZapLeadRegistrationReadRepository({
    userId: userIdA,
    accountId: accountIdA,
  });
  assert.deepEqual(await registrationA.getIntegration(), {
    apiBaseUrl: 'https://synthetic-a.example.test',
    keyId: keyIdA,
  });
  const heartbeatA = await registrationA.getHeartbeatState(keyIdA);
  assert.equal(heartbeatA?.lastErrorCode, 'synthetic-a');
  assert.equal(heartbeatA?.lastSuccessAt instanceof Date, true);
  assert.equal(heartbeatA?.alertSentAt instanceof Date, true);

  const crossAccountRegistration =
    createPostgresZapLeadRegistrationReadRepository({
      userId: userIdA,
      accountId: accountIdB,
    });
  assert.equal(await crossAccountRegistration.getIntegration(), null);
  assert.equal(await crossAccountRegistration.getHeartbeatState(keyIdB), null);

  const viewerRegistrationA = createPostgresZapLeadRegistrationReadRepository({
    userId: viewerIdA,
    accountId: accountIdA,
  });
  assert.equal(await viewerRegistrationA.getIntegration(), null);

  const eventStreamA = createPostgresZapLeadEventStreamReadRepository({
    userId: userIdA,
    accountId: accountIdA,
  });
  assert.deepEqual(await eventStreamA.getIntegration(), {
    accountId: accountIdA,
    apiBaseUrl: 'https://synthetic-a.example.test',
    encryptedRegistration: 'synthetic-encrypted-registration-a',
  });
  assert.equal(await eventStreamA.getCursor(keyIdA), cursorA);
  assert.equal(await eventStreamA.getCursor(keyIdB), null);

  const crossAccountState = requireSuccess(
    await withTransaction(async (transaction) => {
      await transaction.query(
        "SELECT pg_catalog.set_config('request.jwt.claim.sub', $1, true)",
        [userIdA]
      );
      return transaction.query(
        'SELECT account_id, integration_key_id ' +
          'FROM public.zap_lead_integration_state ' +
          'WHERE integration_key_id = $1::text',
        [keyIdB]
      );
    }),
    'cross-account integration-state RLS probe'
  );
  assert.deepEqual(crossAccountState.rows, []);

  const crossAccountEventStream =
    createPostgresZapLeadEventStreamReadRepository({
      userId: userIdA,
      accountId: accountIdB,
    });
  assert.equal(await crossAccountEventStream.getIntegration(), null);

  const eventStreamB = createPostgresZapLeadEventStreamReadRepository({
    userId: userIdB,
    accountId: accountIdB,
  });
  assert.equal((await eventStreamB.getIntegration())?.accountId, accountIdB);

  const cleanupClient = await pool.connect();
  let cleanupTransactionStarted = false;
  try {
    await cleanupClient.query('BEGIN');
    cleanupTransactionStarted = true;
    await cleanupClient.query('SELECT pg_catalog.set_config($1, $2, true)', [
      keySetting,
      keyIdA,
    ]);
    await cleanupClient.query(
      "SELECT pg_catalog.set_config('request.jwt.claim.sub', $1, true)",
      [userIdA]
    );
    await cleanupClient.query('COMMIT');
    cleanupTransactionStarted = false;

    const cleanup = await cleanupClient.query(
      `SELECT pg_catalog.current_setting($1, true) AS key_id,
              pg_catalog.current_setting('request.jwt.claim.sub', true)
                AS subject`,
      [keySetting]
    );
    assert.ok(
      cleanup.rows[0].key_id === null || cleanup.rows[0].key_id === '',
      `transaction-local key filter leaked: ${cleanup.rows[0].key_id}`
    );
    assert.ok(
      cleanup.rows[0].subject === null || cleanup.rows[0].subject === '',
      `transaction-local request identity leaked: ${cleanup.rows[0].subject}`
    );
  } catch (error) {
    if (cleanupTransactionStarted) {
      await cleanupClient.query('ROLLBACK').catch(() => {});
    }
    throw error;
  } finally {
    cleanupClient.release();
  }

  console.log(
    'PASS: webhook/registration/event-stream reads, cross-account registration/cursor/state RLS isolation, admin-only registration visibility, forced RLS on a non-superuser owner, column-only SELECT, restricted metadata, and same-connection transaction-local key/JWT cleanup.'
  );
} finally {
  await pool.end();
}
