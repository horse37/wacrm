import assert from 'node:assert/strict';
import { queryDb, withTransaction } from '../../src/lib/db/postgres-client.ts';
import { getPostgresPool } from '../../src/lib/db/postgres-pool.ts';
import { createPostgresWhatsAppSendMessageRepository } from '../../src/lib/repositories/whatsapp-send-message.ts';

const userAgent = '00000000-0000-4000-8000-000000000001';
const userViewer = '00000000-0000-4000-8000-000000000002';
const userOtherAccount = '00000000-0000-4000-8000-000000000003';
const accountA = '10000000-0000-4000-8000-000000000001';
const accountB = '10000000-0000-4000-8000-000000000002';
const conversationA = '20000000-0000-4000-8000-000000000001';
const conversationB = '20000000-0000-4000-8000-000000000002';
const parentMessage = '30000000-0000-4000-8000-000000000001';
const pool = getPostgresPool();

function requireSuccess(result, label) {
  if (!result.ok) throw new Error(`${label} failed with ${result.error.code}`);
  return result.data;
}

function sendRepository(userId, accountId) {
  return createPostgresWhatsAppSendMessageRepository({ userId, accountId });
}

const sentMessage = {
  contentType: 'text',
  contentText: 'synthetic outbound message',
  mediaUrl: null,
  templateName: null,
  providerMessageId: 'synthetic-provider-message',
  replyToMessageId: parentMessage,
};

try {
  const runtime = requireSuccess(
    await queryDb(
      'SELECT current_user AS role, rolbypassrls FROM pg_roles WHERE rolname = current_user'
    ),
    'runtime role probe'
  );
  assert.deepEqual(runtime.rows, [
    { role: 'wacrm_whatsapp_message_runtime', rolbypassrls: false },
  ]);

  const rls = requireSuccess(
    await queryDb(
      `SELECT c.relname, c.relrowsecurity, c.relforcerowsecurity
       FROM pg_class AS c
       INNER JOIN pg_namespace AS n ON n.oid = c.relnamespace
       WHERE n.nspname = 'public'
         AND c.relname = ANY($1::text[])
       ORDER BY c.relname`,
      [['conversations', 'messages']]
    ),
    'forced row-level security probe'
  );
  assert.deepEqual(
    rls.rows,
    ['conversations', 'messages'].map((relname) => ({
      relname,
      relrowsecurity: true,
      relforcerowsecurity: true,
    }))
  );

  const repository = sendRepository(userAgent, accountA);
  const insertedId = await repository.insertSentMessage({
    ...sentMessage,
    conversationId: conversationA,
  });
  assert.match(insertedId, /^[0-9a-f-]{36}$/i);

  const persisted = requireSuccess(
    await withTransaction(async (transaction) => {
      await transaction.query(
        "SELECT set_config('request.jwt.claim.sub', $1, true)",
        [userAgent]
      );
      return transaction.query(
        `SELECT id::text AS id,
                conversation_id::text AS conversation_id,
                sender_type,
                content_type,
                content_text,
                media_url,
                template_name,
                message_id,
                status,
                reply_to_message_id::text AS reply_to_message_id
         FROM public.messages
         WHERE id = $1::uuid`,
        [insertedId]
      );
    }),
    'persisted message inspection'
  );
  assert.deepEqual(persisted.rows, [
    {
      id: insertedId,
      conversation_id: conversationA,
      sender_type: 'agent',
      content_type: 'text',
      content_text: 'synthetic outbound message',
      media_url: null,
      template_name: null,
      message_id: 'synthetic-provider-message',
      status: 'sent',
      reply_to_message_id: parentMessage,
    },
  ]);

  await assert.rejects(
    sendRepository(userViewer, accountA).insertSentMessage({
      ...sentMessage,
      conversationId: conversationA,
    }),
    (error) => error.code === 'db_error'
  );
  await assert.rejects(
    repository.insertSentMessage({
      ...sentMessage,
      conversationId: conversationB,
    }),
    (error) => error.code === 'db_error'
  );
  await assert.rejects(
    sendRepository(userOtherAccount, accountB).insertSentMessage({
      ...sentMessage,
      conversationId: conversationA,
    }),
    (error) => error.code === 'db_error'
  );

  const identityAfterTransactions = requireSuccess(
    await queryDb('SELECT auth.uid()::text AS identity'),
    'transaction-local identity cleanup'
  );
  assert.deepEqual(identityAfterTransactions.rows, [{ identity: null }]);

  const deniedCount = requireSuccess(
    await withTransaction(async (transaction) => {
      await transaction.query(
        "SELECT set_config('request.jwt.claim.sub', $1, true)",
        [userAgent]
      );
      return transaction.query(
        'SELECT count(*)::int AS count FROM public.messages WHERE conversation_id = $1::uuid',
        [conversationA]
      );
    }),
    'post-denial row count'
  );
  assert.deepEqual(deniedCount.rows, [{ count: 2 }]);

  console.log(
    'PostgreSQL WhatsApp message insert SUCCESS: NOBYPASSRLS, forced tenant RLS, agent insert, viewer denial, cross-account isolation, persisted fields, reply FK and transaction-local identity cleanup.'
  );
} finally {
  await pool.end();
}
