import assert from 'node:assert/strict';
import { getPostgresPool } from '../../../src/lib/db/postgres-pool.ts';
import {
  queryDb,
  withTransaction,
} from '../../../src/lib/db/postgres-client.ts';
import { createPostgresZapLeadEventStreamReadRepository } from '../../../src/lib/repositories/zap-lead-event-stream-read.ts';

const ownerA = '00000000-0000-4000-8000-000000000001';
const viewerA = '00000000-0000-4000-8000-000000000002';
const ownerB = '00000000-0000-4000-8000-000000000003';
const accountA = '10000000-0000-4000-8000-000000000001';
const accountB = '10000000-0000-4000-8000-000000000002';
const keyA = 'ak_000000000000000000000000';
const keyB = 'ak_111111111111111111111111';
const cursorA = '18fae01a-a5b8-4a7e-95af-453810e49dc9';
const cursorB = '28fae01a-a5b8-4a7e-95af-453810e49dc9';

function requireSuccess(result, label) {
  if (result === null || typeof result !== 'object' || !('ok' in result)) {
    return result;
  }
  if (!result.ok) {
    console.error(label, result);
    throw new Error(`${label} failed`);
  }
  return result.data;
}

function repository(userId, accountId) {
  return createPostgresZapLeadEventStreamReadRepository({ userId, accountId });
}

try {
  const role = requireSuccess(
    await queryDb(
      'SELECT rolbypassrls AS "bypassRls" FROM pg_roles WHERE rolname = current_user'
    ),
    'runtime role check'
  );
  assert.deepEqual(role.rows, [{ bypassRls: false }]);

  const rls = requireSuccess(
    await queryDb(
      "SELECT relname, relforcerowsecurity AS forced FROM pg_class WHERE oid IN ('public.zap_lead_integrations'::regclass, 'public.zap_lead_integration_state'::regclass) ORDER BY relname"
    ),
    'forced RLS check'
  );
  assert.deepEqual(rls.rows, [
    { relname: 'zap_lead_integration_state', forced: true },
    { relname: 'zap_lead_integrations', forced: true },
  ]);

  const integrationA = requireSuccess(
    await repository(ownerA, accountA).getIntegration(),
    'owner A integration read'
  );
  assert.deepEqual(integrationA, {
    accountId: accountA,
    apiBaseUrl: 'https://zap-a.example.test',
    encryptedRegistration: 'synthetic-ciphertext-account-a',
  });
  assert.equal(
    requireSuccess(
      await repository(ownerA, accountA).getCursor(keyA),
      'owner A cursor read'
    ),
    cursorA
  );
  assert.equal(
    requireSuccess(
      await repository(ownerA, accountA).getCursor(keyB),
      'cross-key cursor read'
    ),
    null
  );
  assert.equal(
    requireSuccess(
      await repository(viewerA, accountA).getIntegration(),
      'viewer integration read'
    ),
    null
  );
  assert.equal(
    requireSuccess(
      await repository(viewerA, accountA).getCursor(keyA),
      'viewer cursor read'
    ),
    null
  );
  assert.equal(
    requireSuccess(
      await repository(ownerA, accountB).getIntegration(),
      'cross-account integration read'
    ),
    null
  );
  assert.equal(
    requireSuccess(
      await repository(ownerA, accountB).getCursor(keyB),
      'cross-account cursor read'
    ),
    null
  );
  const integrationB = requireSuccess(
    await repository(ownerB, accountB).getIntegration(),
    'owner B integration read'
  );
  assert.equal(integrationB.apiBaseUrl, 'https://zap-b.example.test');
  assert.equal(
    requireSuccess(
      await repository(ownerB, accountB).getCursor(keyB),
      'owner B cursor read'
    ),
    cursorB
  );

  const identity = requireSuccess(
    await withTransaction((transaction) =>
      transaction.query('SELECT auth.uid()::text AS identity')
    ),
    'transaction-local identity cleanup probe'
  );
  assert.deepEqual(identity.rows, [{ identity: null }]);

  console.log(
    'PASS: account-scoped integration/cursor reads, key isolation, admin RLS, forced RLS, and transaction-local identity cleanup'
  );
} finally {
  await getPostgresPool().end();
}
