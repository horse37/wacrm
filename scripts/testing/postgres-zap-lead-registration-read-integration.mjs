import assert from 'node:assert/strict';
import { getPostgresPool } from '../../src/lib/db/postgres-pool.ts';
import { queryDb, withTransaction } from '../../src/lib/db/postgres-client.ts';
import { createPostgresZapLeadRegistrationReadRepository } from '../../src/lib/repositories/zap-lead-registration-read.ts';

const ownerA = '00000000-0000-4000-8000-000000000001';
const viewerA = '00000000-0000-4000-8000-000000000002';
const ownerB = '00000000-0000-4000-8000-000000000003';
const accountA = '10000000-0000-4000-8000-000000000001';
const accountB = '10000000-0000-4000-8000-000000000002';

function requireSuccess(result, label) {
  if (!result.ok) throw new Error(`${label} failed with ${result.error.code}`);
  return result.data;
}

function repository(userId, accountId) {
  return createPostgresZapLeadRegistrationReadRepository({ userId, accountId });
}

const pool = getPostgresPool();

try {
  const runtime = requireSuccess(
    await queryDb(
      'SELECT current_user AS role, rolbypassrls FROM pg_roles WHERE rolname = current_user'
    ),
    'runtime role probe'
  );
  assert.deepEqual(runtime.rows, [
    { role: 'wacrm_zap_lead_registration_read_runtime', rolbypassrls: false },
  ]);

  const rls = requireSuccess(
    await queryDb(
      `SELECT c.relname, c.relrowsecurity, c.relforcerowsecurity
       FROM pg_class AS c
       INNER JOIN pg_namespace AS n ON n.oid = c.relnamespace
       WHERE n.nspname = 'public'
         AND c.relname IN (
           'profiles',
           'zap_lead_integrations',
           'zap_lead_integration_state'
         )
       ORDER BY c.relname`
    ),
    'row-level security probe'
  );
  assert.deepEqual(
    rls.rows.map((row) => [row.relname, row.relrowsecurity, row.relforcerowsecurity]),
    [
      ['profiles', true, true],
      ['zap_lead_integration_state', true, true],
      ['zap_lead_integrations', true, true],
    ]
  );

  const integrationA = await repository(ownerA, accountA).getIntegration();
  assert.deepEqual(integrationA, {
    apiBaseUrl: 'https://zap-a.example.test',
    keyId: 'ak_account_a',
  });
  assert.deepEqual(Object.keys(integrationA).sort(), ['apiBaseUrl', 'keyId']);

  const heartbeatA = await repository(ownerA, accountA).getHeartbeatState(
    integrationA.keyId
  );
  assert.equal(heartbeatA.lastSuccessAt.toISOString(), '2026-10-21T09:00:00.000Z');
  assert.equal(heartbeatA.lastFailureAt, null);

  assert.equal(
    await repository(ownerA, accountA).getHeartbeatState('ak_stale_key'),
    null
  );
  assert.equal(await repository(viewerA, accountA).getIntegration(), null);
  assert.equal(await repository(viewerA, accountA).getHeartbeatState('ak_account_a'), null);
  assert.equal(await repository(ownerA, accountB).getIntegration(), null);
  assert.equal(await repository(ownerA, accountB).getHeartbeatState('ak_account_b'), null);

  const integrationB = await repository(ownerB, accountB).getIntegration();
  assert.deepEqual(integrationB, {
    apiBaseUrl: 'https://zap-b.example.test',
    keyId: 'ak_account_b',
  });
  const heartbeatB = await repository(ownerB, accountB).getHeartbeatState(
    integrationB.keyId
  );
  assert.equal(heartbeatB.lastSuccessAt, null);
  assert.equal(heartbeatB.lastErrorCode, 'health_request_failed');
  assert.equal(heartbeatB.alertSentAt.toISOString(), '2026-10-21T09:10:00.000Z');

  const identity = requireSuccess(
    await withTransaction((transaction) =>
      transaction.query('SELECT auth.uid()::text AS identity')
    ),
    'transaction-local identity cleanup probe'
  );
  assert.deepEqual(identity.rows, [{ identity: null }]);

  console.log(
    'PASS: account-scoped configuration/heartbeat reads, key isolation, admin RLS, forced RLS, secret projection, and transaction-local identity cleanup'
  );
} finally {
  await pool.end();
}
