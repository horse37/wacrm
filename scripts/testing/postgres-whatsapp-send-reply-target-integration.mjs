import assert from 'node:assert/strict';
import { queryDb } from '../../src/lib/db/postgres-client.ts';
import { getPostgresPool } from '../../src/lib/db/postgres-pool.ts';
import { createPostgresWhatsAppSendConversationRepository } from '../../src/lib/repositories/whatsapp-send-conversation.ts';

const userA = '00000000-0000-4000-8000-000000000001';
const accountA = '10000000-0000-4000-8000-000000000001';
const conversationA = '20000000-0000-4000-8000-000000000001';
const messageA = '30000000-0000-4000-8000-000000000001';
const unsentMessageA = '30000000-0000-4000-8000-000000000002';
const conversationB = '20000000-0000-4000-8000-000000000002';
const messageB = '30000000-0000-4000-8000-000000000003';
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
    { role: 'wacrm_whatsapp_reply_runtime', rolbypassrls: false },
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

  const repository = createPostgresWhatsAppSendConversationRepository({
    userId: userA,
    accountId: accountA,
  });
  assert.deepEqual(await repository.findReplyTarget(conversationA, messageA), {
    messageId: 'synthetic-provider-message-a',
  });
  assert.deepEqual(
    await repository.findReplyTarget(conversationA, unsentMessageA),
    { messageId: null }
  );
  assert.equal(await repository.findReplyTarget(conversationA, messageB), null);
  assert.equal(await repository.findReplyTarget(conversationB, messageA), null);
  assert.equal(
    await repository.findReplyTarget(conversationA, 'not-a-valid-uuid'),
    null
  );

  const pooledIdentity = requireSuccess(
    await queryDb('SELECT auth.uid()::text AS user_id'),
    'pooled identity cleanup probe'
  );
  assert.deepEqual(pooledIdentity.rows, [{ user_id: null }]);

  const failClosed = requireSuccess(
    await queryDb(
      `SELECT
         (SELECT count(*)::int FROM public.conversations) AS conversations,
         (SELECT count(*)::int FROM public.messages) AS messages`
    ),
    'missing identity RLS probe'
  );
  assert.deepEqual(failClosed.rows, [{ conversations: 0, messages: 0 }]);

  console.log(
    'PostgreSQL WhatsApp reply target SUCCESS: NOBYPASSRLS, forced tenant RLS, same-conversation target, unsent parent, cross-account and cross-conversation isolation, invalid UUID, and transaction-local identity cleanup.'
  );
} finally {
  await pool.end();
}
