import assert from 'node:assert/strict';
import { AppError } from '../../src/lib/db/errors.ts';
import { queryDb, withTransaction } from '../../src/lib/db/postgres-client.ts';
import { getPostgresPool } from '../../src/lib/db/postgres-pool.ts';
import { createPostgresWhatsAppConfigRepository } from '../../src/lib/repositories/whatsapp-config.ts';

const ownerA = '00000000-0000-4000-8000-000000000001';
const viewerA = '00000000-0000-4000-8000-000000000003';
const ownerB = '00000000-0000-4000-8000-000000000002';
const ownerC = '00000000-0000-4000-8000-000000000004';
const accountA = '10000000-0000-4000-8000-000000000001';
const accountB = '10000000-0000-4000-8000-000000000002';
const pool = getPostgresPool();

function requireSuccess(result, label) {
  if (!result.ok) throw new Error(`${label} failed with ${result.error.code}`);
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
    { role: 'wacrm_whatsapp_config_runtime', rolbypassrls: false },
  ]);

  const repositoryA = createPostgresWhatsAppConfigRepository(async () => ({
    userId: ownerA,
  }));
  const repositoryViewerA = createPostgresWhatsAppConfigRepository(
    async () => ({
      userId: viewerA,
    })
  );
  const repositoryB = createPostgresWhatsAppConfigRepository(async () => ({
    userId: ownerB,
  }));
  const repositoryWithoutConfig = createPostgresWhatsAppConfigRepository(
    async () => ({ userId: ownerC })
  );

  const configA = await repositoryA.getConnectionConfig();
  assert.deepEqual(configA, {
    phoneNumberId: 'synthetic-phone-id-a',
    encryptedAccessToken: 'synthetic-ciphertext-a',
    status: 'connected',
  });

  assert.deepEqual(await repositoryViewerA.getConnectionConfig(), configA);

  const configB = await repositoryB.getConnectionConfig();
  assert.deepEqual(configB, {
    phoneNumberId: 'synthetic-phone-id-b',
    encryptedAccessToken: 'synthetic-ciphertext-b',
    status: 'disconnected',
  });
  assert.notEqual(configA?.encryptedAccessToken, configB?.encryptedAccessToken);

  assert.equal(await repositoryWithoutConfig.getConnectionConfig(), null);

  const noSessionRepository = createPostgresWhatsAppConfigRepository(
    async () => null
  );
  await assert.rejects(
    noSessionRepository.getConnectionConfig(),
    (error) => error instanceof AppError && error.code === 'unauthorized'
  );

  const crossAccount = requireSuccess(
    await withTransaction(async (transaction) => {
      await transaction.query(
        "SELECT set_config('request.jwt.claim.sub', $1, true)",
        [ownerA]
      );
      const result = await transaction.query(
        'SELECT account_id::text FROM public.whatsapp_config WHERE account_id = $1',
        [accountB]
      );
      return result.rows;
    }),
    'cross-account config denial probe'
  );
  assert.deepEqual(crossAccount, []);

  const pooledIdentity = requireSuccess(
    await queryDb('SELECT auth.uid()::text AS user_id'),
    'pooled identity reset probe'
  );
  assert.deepEqual(pooledIdentity.rows, [{ user_id: null }]);

  const visibleRows = requireSuccess(
    await queryDb(
      'SELECT account_id::text FROM public.whatsapp_config WHERE account_id = ANY($1::uuid[]) ORDER BY account_id',
      [[accountA, accountB]]
    ),
    'runtime config visibility probe'
  );
  assert.deepEqual(visibleRows.rows, []);

  const deletePrivilege = requireSuccess(
    await queryDb(
      `SELECT
       has_table_privilege(current_user, 'public.whatsapp_config', 'DELETE') AS can_delete,
       has_table_privilege(current_user, 'public.whatsapp_config', 'INSERT') AS can_insert,
       has_table_privilege(current_user, 'public.whatsapp_config', 'UPDATE') AS can_update`
    ),
    'runtime delete privilege probe'
  );
  assert.deepEqual(deletePrivilege.rows, [
    { can_delete: true, can_insert: false, can_update: false },
  ]);

  await repositoryA.deleteConnectionConfig();
  const accountAAfterDelete = requireSuccess(
    await withTransaction(async (transaction) => {
      await transaction.query(
        "SELECT set_config('request.jwt.claim.sub', $1, true)",
        [ownerA]
      );
      const ownRows = await transaction.query(
        'SELECT count(*)::int AS count FROM public.whatsapp_config WHERE account_id = $1',
        [accountA]
      );
      const crossAccountDelete = await transaction.query(
        'DELETE FROM public.whatsapp_config WHERE account_id = $1',
        [accountB]
      );
      return {
        ownCount: ownRows.rows[0]?.count,
        crossAccountDeleted: crossAccountDelete.rowCount,
      };
    }),
    'forced-RLS config deletion isolation'
  );
  assert.deepEqual(accountAAfterDelete, {
    ownCount: 0,
    crossAccountDeleted: 0,
  });

  const accountBAfterDelete = requireSuccess(
    await withTransaction(async (transaction) => {
      await transaction.query(
        "SELECT set_config('request.jwt.claim.sub', $1, true)",
        [ownerB]
      );
      const result = await transaction.query(
        'SELECT count(*)::int AS count FROM public.whatsapp_config WHERE account_id = $1',
        [accountB]
      );
      return result.rows;
    }),
    'cross-account row preservation probe'
  );
  assert.deepEqual(accountBAfterDelete, [{ count: 1 }]);

  await assert.rejects(
    repositoryViewerA.deleteConnectionConfig(),
    (error) => error instanceof AppError && error.code === 'forbidden'
  );
  await repositoryA.deleteConnectionConfig();

  const identityAfterDelete = requireSuccess(
    await queryDb('SELECT auth.uid()::text AS user_id'),
    'post-delete pooled identity reset probe'
  );
  assert.deepEqual(identityAfterDelete.rows, [{ user_id: null }]);

  console.log(
    'PostgreSQL WhatsApp config delete integration SUCCESS: NOBYPASSRLS role, admin-only DELETE grant and policy, account-scoped deletion, cross-account denial, non-admin denial, idempotent absent-row success, and transaction-local identity cleanup.'
  );
} finally {
  await pool.end();
}
