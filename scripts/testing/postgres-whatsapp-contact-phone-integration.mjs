import assert from 'node:assert/strict';
import { queryDb, withTransaction } from '../../src/lib/db/postgres-client.ts';
import { getPostgresPool } from '../../src/lib/db/postgres-pool.ts';
import { createPostgresWhatsAppSendConversationRepository } from '../../src/lib/repositories/whatsapp-send-conversation.ts';

const ownerA = '00000000-0000-4000-8000-000000000001';
const viewerA = '00000000-0000-4000-8000-000000000003';
const ownerB = '00000000-0000-4000-8000-000000000002';
const accountA = '10000000-0000-4000-8000-000000000001';
const accountB = '10000000-0000-4000-8000-000000000002';
const contactA = '40000000-0000-4000-8000-000000000001';
const originalPhone = '+15550000001';
const correctedPhone = '+15550000002';
const pool = getPostgresPool();

function requireSuccess(result, label) {
  if (!result.ok) throw new Error(`${label} failed with ${result.error.code}`);
  return result.data;
}

async function readContactPhone(userId, accountId, contactId) {
  return requireSuccess(
    await withTransaction(async (transaction) => {
      await transaction.query(
        "SELECT set_config('request.jwt.claim.sub', $1, true)",
        [userId]
      );
      const result = await transaction.query(
        `SELECT phone
         FROM public.contacts
         WHERE id = $1::uuid AND account_id = $2::uuid`,
        [contactId, accountId]
      );
      return result.rows[0]?.phone ?? null;
    }),
    'scoped contact read'
  );
}

try {
  const runtime = requireSuccess(
    await queryDb(
      'SELECT current_user AS role, rolbypassrls FROM pg_roles WHERE rolname = current_user'
    ),
    'runtime role probe'
  );
  assert.deepEqual(runtime.rows, [
    { role: 'wacrm_whatsapp_contact_runtime', rolbypassrls: false },
  ]);

  const rls = requireSuccess(
    await queryDb(
      `SELECT relrowsecurity AS enabled, relforcerowsecurity AS forced
       FROM pg_class
       WHERE oid = 'public.contacts'::regclass`
    ),
    'forced RLS probe'
  );
  assert.deepEqual(rls.rows, [{ enabled: true, forced: true }]);

  const ownerRepository = createPostgresWhatsAppSendConversationRepository({
    userId: ownerA,
    accountId: accountA,
  });
  assert.equal(
    await readContactPhone(ownerA, accountA, contactA),
    originalPhone
  );
  assert.equal(
    await ownerRepository.updateContactPhone(contactA, correctedPhone),
    true
  );
  assert.equal(
    await readContactPhone(ownerA, accountA, contactA),
    correctedPhone
  );

  const viewerRepository = createPostgresWhatsAppSendConversationRepository({
    userId: viewerA,
    accountId: accountA,
  });
  assert.equal(
    await viewerRepository.updateContactPhone(contactA, '+15550000004'),
    false
  );
  assert.equal(
    await readContactPhone(ownerA, accountA, contactA),
    correctedPhone
  );

  const otherAccountRepository =
    createPostgresWhatsAppSendConversationRepository({
      userId: ownerB,
      accountId: accountB,
    });
  assert.equal(
    await otherAccountRepository.updateContactPhone(contactA, '+15550000005'),
    false
  );
  assert.equal(
    await readContactPhone(ownerA, accountA, contactA),
    correctedPhone
  );
  assert.equal(
    await ownerRepository.updateContactPhone('invalid-id', 'x'),
    false
  );

  const identity = requireSuccess(
    await queryDb('SELECT auth.uid()::text AS user_id'),
    'transaction identity cleanup probe'
  );
  assert.deepEqual(identity.rows, [{ user_id: null }]);

  console.log(
    'PostgreSQL contact phone integration SUCCESS: NOBYPASSRLS, owner update, viewer denial, cross-account isolation, and transaction-local identity cleanup.'
  );
} finally {
  await pool.end();
}
