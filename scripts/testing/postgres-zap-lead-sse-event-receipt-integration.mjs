import assert from 'node:assert/strict';
import pg from 'pg';
import { getPostgresPool } from '../../src/lib/db/postgres-pool.ts';
import { recordZapLeadSseEventReceipt } from '../../src/lib/repositories/zap-lead-sse-event-receipt.ts';

const { Client } = pg;
const accountIdA = '10000000-0000-4000-8000-000000000001';
const accountIdB = '10000000-0000-4000-8000-000000000002';
const keyIdA = 'ak_aaaaaaaaaaaaaaaaaaaaaaaa';
const initialCursor = '18fae01a-a5b8-4a7e-95af-453810e49dc9';
const acceptedEventId = '38fae01a-a5b8-4a7e-95af-453810e49dc9';
const newerEventId = '48fae01a-a5b8-4a7e-95af-453810e49dc9';
const staleEventId = '58fae01a-a5b8-4a7e-95af-453810e49dc9';
const invalidTypeEventId = '68fae01a-a5b8-4a7e-95af-453810e49dc9';
const mismatchEventId = '78fae01a-a5b8-4a7e-95af-453810e49dc9';
const raceEventIdA = '88fae01a-a5b8-4a7e-95af-453810e49dc9';
const raceEventIdB = '98fae01a-a5b8-4a7e-95af-453810e49dc9';
const pool = getPostgresPool();
const adminUrl = process.env.WACRM_TEST_ADMIN_DATABASE_URL;

if (!adminUrl) {
  throw new Error(
    'WACRM_TEST_ADMIN_DATABASE_URL is required for disposable assertions'
  );
}

async function readCursor(client) {
  const result = await client.query(
    'SELECT last_sse_cursor_id AS cursor FROM public.zap_lead_integration_state WHERE account_id = $1::uuid',
    [accountIdA]
  );
  assert.equal(result.rows.length, 1);
  return result.rows[0].cursor;
}

async function readReceiptCount(client, eventIds) {
  const result = await client.query(
    'SELECT count(*)::integer AS count FROM public.zap_lead_event_receipts WHERE account_id = $1::uuid AND event_id = ANY($2::uuid[]) AND source = $3::text',
    [accountIdA, eventIds, 'sse']
  );
  return result.rows[0].count;
}

const admin = new Client({ connectionString: adminUrl });

try {
  await admin.connect();

  const receipt = {
    accountId: accountIdA,
    keyId: keyIdA,
    eventId: acceptedEventId,
    eventType: 'conversation.message.created',
    occurredAt: '2026-10-23T03:00:00.000Z',
  };

  assert.equal(
    await recordZapLeadSseEventReceipt(receipt, initialCursor),
    'accepted'
  );
  assert.equal(await readCursor(admin), acceptedEventId);
  console.log('PASS: accepted SSE event advances cursor');

  assert.equal(
    await recordZapLeadSseEventReceipt(receipt, acceptedEventId),
    'duplicate'
  );
  assert.equal(await readCursor(admin), acceptedEventId);
  console.log('PASS: duplicate SSE event preserves current cursor');

  assert.equal(
    await recordZapLeadSseEventReceipt(
      { ...receipt, eventId: invalidTypeEventId, eventType: 'invalid.event' },
      acceptedEventId
    ),
    'invalid'
  );
  assert.equal(await readCursor(admin), acceptedEventId);
  console.log(
    'PASS: unsupported SSE event type is invalid without cursor change'
  );

  assert.equal(
    await recordZapLeadSseEventReceipt(
      { ...receipt, accountId: accountIdB, eventId: mismatchEventId },
      null
    ),
    'invalid'
  );
  assert.equal(await readCursor(admin), acceptedEventId);
  console.log('PASS: account/key mismatch is invalid without cursor change');

  assert.equal(
    await recordZapLeadSseEventReceipt(
      { ...receipt, eventId: staleEventId },
      initialCursor
    ),
    'stale'
  );
  assert.equal(await readCursor(admin), acceptedEventId);
  console.log('PASS: stale expected cursor does not move the account cursor');

  assert.equal(
    await recordZapLeadSseEventReceipt(
      { ...receipt, eventId: newerEventId },
      acceptedEventId
    ),
    'accepted'
  );
  assert.equal(await readCursor(admin), newerEventId);
  console.log('PASS: newer event advances cursor from the expected value');

  const raced = await Promise.all([
    recordZapLeadSseEventReceipt(
      { ...receipt, eventId: raceEventIdA },
      newerEventId
    ),
    recordZapLeadSseEventReceipt(
      { ...receipt, eventId: raceEventIdB },
      newerEventId
    ),
  ]);
  assert.deepEqual([...raced].sort(), ['accepted', 'stale']);
  const cursorAfterRace = await readCursor(admin);
  assert.ok([raceEventIdA, raceEventIdB].includes(cursorAfterRace));
  assert.equal(await readReceiptCount(admin, [raceEventIdA, raceEventIdB]), 2);
  console.log('PASS: concurrent receipts serialize cursor advancement');

  console.log(
    'NOTE: test-only EXECUTE grant exists only in disposable PostgreSQL; it does not establish runtime readiness or H-DB-003 approval.'
  );
} finally {
  await admin.end();
  await pool.end();
}
