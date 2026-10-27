import assert from 'node:assert/strict';
import pg from 'pg';
import { getPostgresPool } from '../../src/lib/db/postgres-pool.ts';
import { acceptZapLeadWebhookReceipt } from '../../src/lib/repositories/zap-lead-webhook-receipt.ts';

const { Client } = pg;
const accountIdA = '10000000-0000-4000-8000-000000000001';
const accountIdB = '10000000-0000-4000-8000-000000000002';
const keyIdA = 'ak_aaaaaaaaaaaaaaaaaaaaaaaa';
const seededEventId = '18fae01a-a5b8-4a7e-95af-453810e49dc9';
const newerEventId = '38fae01a-a5b8-4a7e-95af-453810e49dc9';
const duplicateEventId = '48fae01a-a5b8-4a7e-95af-453810e49dc9';
const replayEventId = '58fae01a-a5b8-4a7e-95af-453810e49dc9';
const olderEventId = '68fae01a-a5b8-4a7e-95af-453810e49dc9';
const rollbackEventId = '78fae01a-a5b8-4a7e-95af-453810e49dc9';
const pool = getPostgresPool();
const disposableAdminUrl = process.env.WACRM_TEST_ADMIN_DATABASE_URL;
if (!disposableAdminUrl) {
  throw new Error(
    'WACRM_TEST_ADMIN_DATABASE_URL is required for disposable assertions'
  );
}

function receipt(overrides = {}) {
  return {
    accountId: accountIdA,
    keyId: keyIdA,
    nonce: 'receipt-nonce-primary-0001',
    eventId: newerEventId,
    eventType: 'lead.created',
    occurredAt: '2026-10-21T12:30:00.000Z',
    ...overrides,
  };
}

async function readAccountAState() {
  const client = new Client({ connectionString: disposableAdminUrl });
  try {
    await client.connect();
    const result = await client.query(
      'SELECT last_event_id AS "lastEventId", ' +
        'last_event_at AS "lastEventAt" ' +
        'FROM public.zap_lead_integration_state WHERE account_id = $1::uuid',
      [accountIdA]
    );
    assert.equal(result.rows.length, 1);
    return result.rows[0];
  } finally {
    await client.end();
  }
}

try {
  assert.equal(await acceptZapLeadWebhookReceipt(receipt()), 'accepted');
  console.log('PASS: new nonce and event are accepted');

  assert.equal(
    await acceptZapLeadWebhookReceipt(
      receipt({ nonce: 'receipt-nonce-duplicate-0002' })
    ),
    'duplicate'
  );
  console.log('PASS: repeated event with a fresh nonce is duplicate');

  assert.equal(
    await acceptZapLeadWebhookReceipt(
      receipt({
        eventId: duplicateEventId,
        nonce: 'receipt-nonce-primary-0001',
      })
    ),
    'replay'
  );
  console.log('PASS: repeated nonce is rejected as replay');

  assert.equal(
    await acceptZapLeadWebhookReceipt(
      receipt({
        accountId: accountIdB,
        eventId: replayEventId,
        nonce: 'receipt-nonce-cross-account-0003',
      })
    ),
    'invalid'
  );
  console.log('PASS: account/key mismatch is invalid');

  assert.equal(
    await acceptZapLeadWebhookReceipt(
      receipt({
        eventId: olderEventId,
        nonce: 'receipt-nonce-older-event-0004',
        occurredAt: '2026-10-19T12:30:00.000Z',
      })
    ),
    'accepted'
  );
  const stateAfterOlderEvent = await readAccountAState();
  assert.equal(stateAfterOlderEvent.lastEventId, newerEventId);
  assert.equal(
    stateAfterOlderEvent.lastEventAt.toISOString(),
    '2026-10-21T12:30:00.000Z'
  );
  console.log('PASS: older event does not move the account cursor backward');

  await assert.rejects(
    acceptZapLeadWebhookReceipt(
      receipt({
        eventId: rollbackEventId,
        nonce: 'receipt-nonce-rollback-0005',
        eventType: 'synthetic.invalid.event',
      })
    ),
    /Could not persist Zap Lead webhook receipt/
  );
  assert.equal(
    await acceptZapLeadWebhookReceipt(
      receipt({
        eventId: rollbackEventId,
        nonce: 'receipt-nonce-rollback-0005',
        occurredAt: '2026-10-22T12:30:00.000Z',
      })
    ),
    'accepted'
  );
  console.log(
    'PASS: failed receipt rolls back nonce so valid retry can succeed'
  );

  const finalState = await readAccountAState();
  assert.equal(finalState.lastEventId, rollbackEventId);
  assert.equal(
    finalState.lastEventAt.toISOString(),
    '2026-10-22T12:30:00.000Z'
  );
  assert.notEqual(finalState.lastEventId, seededEventId);
  console.log('PASS: newest accepted event updates the cursor');
  console.log(
    'NOTE: this disposable fixture temporarily grants function EXECUTE to wacrm_runtime; it does not establish runtime privilege readiness or H-DB-003 approval.'
  );
} finally {
  await pool.end();
}
