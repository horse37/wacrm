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
    configId: '20000000-0000-4000-8000-000000000001',
    phoneNumberId: 'synthetic-phone-id-a',
    encryptedAccessToken: 'synthetic-ciphertext-a',
    status: 'connected',
  });

  assert.deepEqual(await repositoryViewerA.getConnectionConfig(), configA);

  const configB = await repositoryB.getConnectionConfig();
  assert.deepEqual(configB, {
    configId: '20000000-0000-4000-8000-000000000002',
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

  console.log(
    'PostgreSQL WhatsApp config read integration SUCCESS: NOBYPASSRLS role, viewer access, verified account scope, cross-account denial, absent config, and transaction-local identity cleanup.'
  );
} finally {
  await pool.end();
}
