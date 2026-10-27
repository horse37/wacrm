import assert from 'node:assert/strict';
import { queryDb, withTransaction } from '../../src/lib/db/postgres-client.ts';
import { getPostgresPool } from '../../src/lib/db/postgres-pool.ts';
import { createPostgresWhatsAppSendConversationRepository } from '../../src/lib/repositories/whatsapp-send-conversation.ts';

const userOwner = '00000000-0000-4000-8000-000000000001';
const userViewer = '00000000-0000-4000-8000-000000000002';
const userOtherAccount = '00000000-0000-4000-8000-000000000003';
const accountA = '10000000-0000-4000-8000-000000000001';
const accountB = '10000000-0000-4000-8000-000000000002';
const conversationA = '20000000-0000-4000-8000-000000000001';
const conversationB = '20000000-0000-4000-8000-000000000002';
const conversationMissing = '20000000-0000-4000-8000-000000000003';
const pool = getPostgresPool();

function requireSuccess(result, label) {
  if (!result.ok) throw new Error(`${label} failed with ${result.error.code}`);
  return result.data;
}

function repository(userId, accountId) {
  return createPostgresWhatsAppSendConversationRepository({
    userId,
    accountId,
  });
}

async function readConversation(userId, accountId, conversationId) {
  return requireSuccess(
    await withTransaction(async (transaction) => {
      await transaction.query(
        "SELECT set_config('request.jwt.claim.sub', $1, true)",
        [userId]
      );
      return transaction.query(
        `SELECT id::text AS id, account_id::text AS account_id,
                last_message_text, last_message_at::text AS last_message_at,
                updated_at::text AS updated_at
         FROM public.conversations
         WHERE id = $1::uuid AND account_id = $2::uuid`,
        [conversationId, accountId]
      );
    }),
    'conversation read'
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
    { role: 'wacrm_whatsapp_conversation_runtime', rolbypassrls: false },
  ]);

  const rls = requireSuccess(
    await queryDb(
      `SELECT c.relname, c.relrowsecurity, c.relforcerowsecurity
       FROM pg_class AS c
       INNER JOIN pg_namespace AS n ON n.oid = c.relnamespace
       WHERE n.nspname = 'public' AND c.relname = 'conversations'`
    ),
    'forced row-level security probe'
  );
  assert.deepEqual(rls.rows, [
    {
      relname: 'conversations',
      relrowsecurity: true,
      relforcerowsecurity: true,
    },
  ]);

  const acceptedUpdate = {
    conversationId: conversationA,
    lastMessageText: 'synthetic outbound message',
    lastMessageAt: '2026-10-21T09:00:00.000Z',
    updatedAt: '2026-10-21T09:00:00.001Z',
  };
  assert.equal(
    await repository(userOwner, accountA).updateAfterSend(acceptedUpdate),
    true
  );
  const persisted = await readConversation(userOwner, accountA, conversationA);
  assert.equal(persisted.rows.length, 1);
  assert.equal(
    persisted.rows[0].last_message_text,
    acceptedUpdate.lastMessageText
  );
  assert.equal(
    Date.parse(persisted.rows[0].last_message_at),
    Date.parse(acceptedUpdate.lastMessageAt)
  );
  assert.equal(
    Date.parse(persisted.rows[0].updated_at),
    Date.parse(acceptedUpdate.updatedAt)
  );

  assert.equal(
    await repository(userViewer, accountA).updateAfterSend({
      ...acceptedUpdate,
      lastMessageText: 'viewer must not change this',
    }),
    false
  );
  assert.equal(
    await repository(userOwner, accountA).updateAfterSend({
      ...acceptedUpdate,
      conversationId: conversationB,
      lastMessageText: 'cross-account must not change this',
    }),
    false
  );
  assert.equal(
    await repository(userOwner, accountA).updateAfterSend({
      ...acceptedUpdate,
      conversationId: conversationMissing,
      lastMessageText: 'missing conversation must remain absent',
    }),
    false
  );
  assert.equal(
    await repository(userOwner, accountA).updateAfterSend({
      ...acceptedUpdate,
      conversationId: 'not-a-uuid',
    }),
    false
  );

  const unchangedA = await readConversation(userOwner, accountA, conversationA);
  assert.equal(
    unchangedA.rows[0].last_message_text,
    acceptedUpdate.lastMessageText
  );
  const unchangedB = await readConversation(
    userOtherAccount,
    accountB,
    conversationB
  );
  assert.equal(unchangedB.rows[0].last_message_text, 'old B');

  const identity = requireSuccess(
    await queryDb('SELECT auth.uid()::text AS user_id'),
    'transaction-local identity cleanup probe'
  );
  assert.deepEqual(identity.rows, [{ user_id: null }]);
  console.log(
    'PASS: conversation update owner, viewer denial, account isolation, missing conversation returns false, invalid UUID, persisted values, forced RLS, and transaction-local identity cleanup'
  );
} finally {
  await pool.end();
}
