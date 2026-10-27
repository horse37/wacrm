import assert from 'node:assert/strict';
import { AppError } from '../../src/lib/db/errors.ts';
import { queryDb, withTransaction } from '../../src/lib/db/postgres-client.ts';
import { getPostgresPool } from '../../src/lib/db/postgres-pool.ts';
import { createPostgresWhatsAppConfigRepository } from '../../src/lib/repositories/whatsapp-config.ts';

const ownerA = '00000000-0000-4000-8000-000000000001';
const viewerA = '00000000-0000-4000-8000-000000000003';
const agentA = '00000000-0000-4000-8000-000000000006';
const ownerB = '00000000-0000-4000-8000-000000000002';
const ownerC = '00000000-0000-4000-8000-000000000004';
const adminA = '00000000-0000-4000-8000-000000000005';
const accountA = '10000000-0000-4000-8000-000000000001';
const accountB = '10000000-0000-4000-8000-000000000002';
const accountC = '10000000-0000-4000-8000-000000000003';
const pool = getPostgresPool();

function requireSuccess(result, label) {
  if (!result.ok) throw new Error(`${label} failed with ${result.error.code}`);
  return result.data;
}

function repository(userId) {
  return createPostgresWhatsAppConfigRepository(async () => ({ userId }));
}

async function rowsAs(userId, sql, values = []) {
  return requireSuccess(
    await withTransaction(async (transaction) => {
      await transaction.query(
        "SELECT set_config('request.jwt.claim.sub', $1, true)",
        [userId]
      );
      const result = await transaction.query(sql, values);
      return result.rows;
    }),
    'account-scoped row probe'
  );
}

async function queryAs(userId, sql, values = []) {
  return withTransaction(async (transaction) => {
    await transaction.query(
      "SELECT set_config('request.jwt.claim.sub', $1, true)",
      [userId]
    );
    return transaction.query(sql, values);
  });
}

function configWrite(phoneNumberId, overrides = {}) {
  return {
    phoneNumberId,
    wabaId: 'synthetic-waba-id',
    encryptedAccessToken: 'synthetic-encrypted-access-token',
    encryptedVerifyToken: 'synthetic-encrypted-verify-token',
    status: 'connected',
    connectedAt: '2026-10-20T12:30:00.000Z',
    registeredAt: '2026-10-20T12:31:00.000Z',
    subscribedAppsAt: '2026-10-20T12:32:00.000Z',
    lastRegistrationError: null,
    updatedAt: '2026-10-20T12:33:00.000Z',
    ...overrides,
  };
}

try {
  const role = requireSuccess(
    await queryDb(
      'SELECT current_user AS role, rolsuper, rolbypassrls FROM pg_roles WHERE rolname = current_user'
    ),
    'runtime role probe'
  );
  assert.deepEqual(role.rows, [
    {
      role: 'wacrm_whatsapp_config_runtime',
      rolsuper: false,
      rolbypassrls: false,
    },
  ]);

  const rls = requireSuccess(
    await queryDb(
      `SELECT relrowsecurity, relforcerowsecurity
       FROM pg_class
       WHERE oid = 'public.whatsapp_config'::regclass`
    ),
    'forced row-level security probe'
  );
  assert.deepEqual(rls.rows, [
    { relrowsecurity: true, relforcerowsecurity: true },
  ]);

  const grants = requireSuccess(
    await queryDb(
      `SELECT
         has_table_privilege(current_user, 'public.whatsapp_config', 'SELECT') AS can_select,
         has_column_privilege(current_user, 'public.whatsapp_config', 'account_id', 'INSERT') AS can_insert_account,
         has_column_privilege(current_user, 'public.whatsapp_config', 'phone_number_id', 'UPDATE') AS can_update_phone,
      has_column_privilege(current_user, 'public.whatsapp_config', 'user_id', 'UPDATE') AS can_update_user,
      has_column_privilege(current_user, 'public.whatsapp_config', 'account_id', 'UPDATE') AS can_update_account,
         has_column_privilege(current_user, 'public.whatsapp_config', 'id', 'UPDATE') AS can_update_id,
      has_column_privilege(current_user, 'public.whatsapp_config', 'id', 'INSERT') AS can_insert_id,
      has_column_privilege(current_user, 'public.whatsapp_config', 'created_at', 'INSERT') AS can_insert_created_at,
      has_table_privilege(current_user, 'public.whatsapp_config', 'DELETE') AS can_delete,
      has_table_privilege(current_user, 'public.whatsapp_config', 'TRUNCATE') AS can_truncate`
    ),
    'runtime grant probe'
  );
  assert.deepEqual(grants.rows, [
    {
      can_select: true,
      can_insert_account: true,
      can_update_phone: true,
      can_update_user: false,
      can_update_account: false,
      can_update_id: false,
      can_insert_id: false,
      can_insert_created_at: false,
      can_delete: false,
      can_truncate: false,
    },
  ]);

  const repositoryA = repository(ownerA);
  const repositoryB = repository(ownerB);
  const repositoryC = repository(ownerC);
  const repositoryViewerA = repository(viewerA);
  const repositoryAgentA = repository(agentA);

  const insertGlobalConflict = await queryAs(
    ownerC,
    `INSERT INTO public.whatsapp_config (
       account_id, user_id, phone_number_id, access_token, status
     ) VALUES ($1, $2, $3, $4, 'connected')`,
    [accountC, ownerC, 'synthetic-phone-id-b', 'synthetic-ciphertext']
  );
  assert.equal(insertGlobalConflict.ok, false);
  assert.equal(insertGlobalConflict.error.code, 'conflict');
  assert.deepEqual(
    await rowsAs(
      ownerC,
      'SELECT account_id::text FROM public.whatsapp_config WHERE account_id = $1',
      [accountC]
    ),
    []
  );

  const stateA = await repositoryA.getRegistrationState();
  assert.equal(stateA?.phoneNumberId, 'synthetic-phone-id-a');
  assert.ok(stateA?.registeredAt);

  const diagnosticsA = await repositoryA.getRegistrationDiagnostics();
  assert.deepEqual(diagnosticsA, {
    phoneNumberId: 'synthetic-phone-id-a',
    wabaId: 'synthetic-waba-a',
    encryptedAccessToken: 'synthetic-ciphertext-a',
    registeredAt: new Date('2026-10-19T12:00:00.000Z'),
    subscribedAppsAt: null,
    lastRegistrationError: null,
  });
  const viewerDiagnosticsA =
    await repositoryViewerA.getRegistrationDiagnostics();
  assert.equal(viewerDiagnosticsA?.phoneNumberId, 'synthetic-phone-id-a');
  assert.equal(
    viewerDiagnosticsA?.encryptedAccessToken,
    'synthetic-ciphertext-a'
  );

  await repositoryA.saveConnectionConfig(
    configWrite('synthetic-phone-id-a-updated', {
      encryptedAccessToken: 'synthetic-updated-ciphertext-a',
      registeredAt: null,
      subscribedAppsAt: null,
    })
  );
  const updatedA = await rowsAs(
    ownerA,
    `SELECT account_id::text AS "accountId", user_id::text AS "userId",
            phone_number_id AS "phoneNumberId", access_token AS "encryptedAccessToken",
            status, registered_at AS "registeredAt"
       FROM public.whatsapp_config WHERE account_id = $1`,
    [accountA]
  );
  assert.deepEqual(updatedA, [
    {
      accountId: accountA,
      userId: adminA,
      phoneNumberId: 'synthetic-phone-id-a-updated',
      encryptedAccessToken: 'synthetic-updated-ciphertext-a',
      status: 'connected',
      registeredAt: null,
    },
  ]);

  assert.equal(await repositoryC.getRegistrationState(), null);
  assert.equal(await repositoryC.getRegistrationDiagnostics(), null);
  await repositoryC.saveConnectionConfig(
    configWrite('synthetic-phone-id-c', { registeredAt: null })
  );
  const insertedC = await rowsAs(
    ownerC,
    'SELECT user_id::text AS "userId", phone_number_id AS "phoneNumberId" FROM public.whatsapp_config WHERE account_id = $1',
    [accountC]
  );
  assert.deepEqual(insertedC, [
    { userId: ownerC, phoneNumberId: 'synthetic-phone-id-c' },
  ]);

  await assert.rejects(
    repositoryA.saveConnectionConfig(
      configWrite('synthetic-phone-id-b', {
        encryptedAccessToken: 'synthetic-must-not-overwrite-a',
      })
    ),
    (error) => error instanceof AppError && error.code === 'conflict'
  );
  const afterConflictA = await rowsAs(
    ownerA,
    'SELECT phone_number_id AS "phoneNumberId", access_token AS "encryptedAccessToken" FROM public.whatsapp_config WHERE account_id = $1',
    [accountA]
  );
  assert.deepEqual(afterConflictA, [
    {
      phoneNumberId: 'synthetic-phone-id-a-updated',
      encryptedAccessToken: 'synthetic-updated-ciphertext-a',
    },
  ]);

  assert.equal(
    (await repositoryB.getRegistrationState())?.phoneNumberId,
    'synthetic-phone-id-b'
  );
  const hiddenAccountB = await rowsAs(
    ownerA,
    'SELECT account_id::text FROM public.whatsapp_config WHERE account_id = $1',
    [accountB]
  );
  assert.deepEqual(hiddenAccountB, []);

  await assert.rejects(
    repositoryViewerA.saveConnectionConfig(
      configWrite('synthetic-viewer-must-not-insert')
    ),
    (error) => error instanceof AppError && error.code === 'forbidden'
  );
  await assert.rejects(
    repositoryAgentA.saveConnectionConfig(
      configWrite('synthetic-agent-must-not-insert')
    ),
    (error) => error instanceof AppError && error.code === 'forbidden'
  );
  const viewerInsert = await queryAs(
    viewerA,
    `INSERT INTO public.whatsapp_config (
     account_id, user_id, phone_number_id, access_token, status
   ) VALUES ($1, $2, $3, $4, 'connected')`,
    [
      accountA,
      viewerA,
      'synthetic-viewer-must-not-insert',
      'synthetic-ciphertext',
    ]
  );
  assert.equal(viewerInsert.ok, false);
  assert.equal(viewerInsert.error.sqlState, '42501');
  const agentUpdate = await queryAs(
    agentA,
    `UPDATE public.whatsapp_config
   SET phone_number_id = $1
   WHERE account_id = $2`,
    ['synthetic-agent-must-not-update', accountA]
  );
  assert.equal(agentUpdate.ok, true);
  assert.equal(agentUpdate.data.rowCount, 0);
  const crossAccountInsert = await queryAs(
    ownerA,
    `INSERT INTO public.whatsapp_config (
     account_id, user_id, phone_number_id, access_token, status
   ) VALUES ($1, $2, $3, $4, 'connected')`,
    [
      accountB,
      ownerA,
      'synthetic-cross-account-must-not-insert',
      'synthetic-ciphertext',
    ]
  );
  assert.equal(crossAccountInsert.ok, false);
  assert.equal(crossAccountInsert.error.sqlState, '42501');

  const crossAccountUpdate = await queryAs(
    ownerA,
    `UPDATE public.whatsapp_config
     SET phone_number_id = $1
     WHERE account_id = $2`,
    ['synthetic-cross-account-must-not-update', accountB]
  );
  assert.equal(crossAccountUpdate.ok, true);
  assert.equal(crossAccountUpdate.data.rowCount, 0);
  assert.equal(
    (await repositoryB.getRegistrationState())?.phoneNumberId,
    'synthetic-phone-id-b'
  );

  await assert.rejects(
    createPostgresWhatsAppConfigRepository(
      async () => null
    ).saveConnectionConfig(configWrite('synthetic-no-session-must-not-insert')),
    (error) => error instanceof AppError && error.code === 'unauthorized'
  );

  const pooledIdentity = requireSuccess(
    await queryDb('SELECT auth.uid()::text AS user_id'),
    'transaction-local identity cleanup probe'
  );
  assert.deepEqual(pooledIdentity.rows, [{ user_id: null }]);

  console.log(
    'PostgreSQL WhatsApp config integration SUCCESS: disposable-fixture forced-RLS behavior, account-scoped diagnostics reads for owner/viewer and empty configuration, owner/admin account-scoped writes, preserved user_id, forced-RLS denial probes for viewer INSERT, agent UPDATE, and cross-account owner INSERT/UPDATE, global phone conflict on INSERT and UPDATE, denied protected-column grants/TRUNCATE, no-session denial, and transaction-local identity cleanup.'
  );
} finally {
  await pool.end();
}
