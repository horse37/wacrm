import assert from 'node:assert/strict';
import { Client } from 'pg';
import { getPostgresPool } from '../../src/lib/db/postgres-pool.ts';
import {
  claimZapLeadHeartbeatAlert,
  recordZapLeadHealthFailure,
  recordZapLeadHealthSuccess,
} from '../../src/lib/repositories/zap-lead-heartbeat.ts';

const accountId = '10000000-0000-4000-8000-000000000001';
const currentKeyId = 'ak_aaaaaaaaaaaaaaaaaaaaaaaa';
const staleKeyId = 'ak_000000000000000000000000';
const heartbeatBase = new Date(Date.now() + 24 * 60 * 60 * 1000);
const heartbeatAt = (offsetMinutes) =>
  new Date(heartbeatBase.getTime() + offsetMinutes * 60 * 1000);
const adminUrl = process.env.WACRM_TEST_ADMIN_DATABASE_URL;

if (!adminUrl) {
  throw new Error(
    'WACRM_TEST_ADMIN_DATABASE_URL required for disposable assertions'
  );
}

const pool = getPostgresPool();
const admin = new Client({ connectionString: adminUrl });

async function readState() {
  const result = await admin.query(
    'SELECT integration_key_id, last_success_at, last_failure_at, ' +
      'last_error_code, alert_sent_at FROM public.zap_lead_integration_state ' +
      'WHERE account_id = $1::uuid',
    [accountId]
  );
  assert.equal(result.rows.length, 1);
  return result.rows[0];
}

try {
  await admin.connect();

  await admin.query(
    'UPDATE public.zap_lead_integration_state SET integration_key_id = $2, ' +
      'last_success_at = $3::timestamptz, ' +
      'last_failure_at = $3::timestamptz, ' +
      "last_error_code = 'synthetic_old_failure', " +
      'alert_sent_at = $3::timestamptz WHERE account_id = $1::uuid',
    [accountId, currentKeyId, '2026-10-20T09:00:00.000Z']
  );
  const beforeStaleKey = await readState();

  assert.equal(
    await recordZapLeadHealthSuccess(accountId, staleKeyId, heartbeatAt(0)),
    false
  );
  assert.deepEqual(await readState(), beforeStaleKey);
  console.log('PASS: stale credential generation cannot update health success');

  const checkedAt = heartbeatAt(0);
  assert.equal(
    await recordZapLeadHealthSuccess(accountId, currentKeyId, checkedAt),
    true
  );
  let state = await readState();
  assert.equal(state.integration_key_id, currentKeyId);
  assert.equal(state.last_success_at.toISOString(), checkedAt.toISOString());
  assert.equal(state.last_failure_at, null);
  assert.equal(state.last_error_code, null);
  assert.equal(state.alert_sent_at, null);
  console.log('PASS: health success clears older failure and alert state');

  assert.equal(
    await claimZapLeadHeartbeatAlert(accountId, currentKeyId, heartbeatAt(5)),
    false
  );
  assert.equal((await readState()).alert_sent_at, null);
  console.log('PASS: recent health success suppresses heartbeat alert');

  const failedAt = heartbeatAt(30);
  assert.equal(
    await recordZapLeadHealthFailure(
      accountId,
      currentKeyId,
      'health_request_failed',
      failedAt
    ),
    true
  );
  assert.equal(
    await recordZapLeadHealthFailure(
      accountId,
      currentKeyId,
      'invalid_credentials',
      heartbeatAt(31)
    ),
    true
  );
  state = await readState();
  assert.equal(state.last_error_code, 'invalid_credentials');
  console.log('PASS: current credential records both documented failure types');

  const alertTime = heartbeatAt(60);
  assert.equal(
    await claimZapLeadHeartbeatAlert(accountId, currentKeyId, alertTime),
    true
  );
  state = await readState();
  assert.equal(state.alert_sent_at.toISOString(), alertTime.toISOString());
  assert.equal(
    await claimZapLeadHeartbeatAlert(accountId, currentKeyId, alertTime),
    false
  );
  assert.equal(
    (await readState()).alert_sent_at.toISOString(),
    alertTime.toISOString()
  );
  console.log(
    'PASS: stale health permits one alert claim and replay is idempotent'
  );

  const beforeStaleFailure = await readState();
  assert.equal(
    await recordZapLeadHealthFailure(
      accountId,
      staleKeyId,
      'health_request_failed',
      heartbeatAt(61)
    ),
    false
  );
  assert.deepEqual(await readState(), beforeStaleFailure);
  assert.equal(
    await claimZapLeadHeartbeatAlert(accountId, staleKeyId, heartbeatAt(62)),
    false
  );
  console.log(
    'PASS: stale credential generation cannot write failure or claim alert'
  );

  console.log(
    'NOTE: temporary EXECUTE grants are limited to this discarded PostgreSQL database and do not prove runtime readiness or H-DB-003 approval.'
  );
} finally {
  await admin.end();
  await pool.end();
}
