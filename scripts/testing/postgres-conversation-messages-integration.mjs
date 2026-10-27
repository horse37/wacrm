import assert from 'node:assert/strict';
import { AppError } from '../../src/lib/db/errors.ts';
import { queryDb } from '../../src/lib/db/postgres-client.ts';
import { getPostgresPool } from '../../src/lib/db/postgres-pool.ts';
import { createPostgresConversationMessagesRepository } from '../../src/lib/repositories/conversation-messages.ts';

const ownerA = '00000000-0000-4000-8000-000000000001';
const viewerA = '00000000-0000-4000-8000-000000000003';
const ownerB = '00000000-0000-4000-8000-000000000002';
const ownerC = '00000000-0000-4000-8000-000000000004';
const conversationA = '20000000-0000-4000-8000-000000000001';
const conversationB = '20000000-0000-4000-8000-000000000002';
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
    { role: 'wacrm_conversation_messages_runtime', rolbypassrls: false },
  ]);

  const repositoryA = createPostgresConversationMessagesRepository(
    async () => ({
      userId: ownerA,
    })
  );
  const repositoryViewerA = createPostgresConversationMessagesRepository(
    async () => ({ userId: viewerA })
  );
  const repositoryB = createPostgresConversationMessagesRepository(
    async () => ({
      userId: ownerB,
    })
  );
  const repositoryC = createPostgresConversationMessagesRepository(
    async () => ({
      userId: ownerC,
    })
  );

  const messagesA = await repositoryA.listForConversation(conversationA);
  assert.deepEqual(
    messagesA.map((message) => message.id),
    [
      '30000000-0000-4000-8000-000000000001',
      '30000000-0000-4000-8000-000000000002',
    ]
  );
  assert.equal(messagesA[0].created_at, '2026-10-18T12:00:00.000Z');
  assert.equal(messagesA[1].created_at, '2026-10-18T13:00:00.000Z');
  assert.equal(
    messagesA[1].reply_to_message_id,
    '30000000-0000-4000-8000-000000000001'
  );
  assert.equal(messagesA[1].interactive_reply_id, 'synthetic-button-id');
  assert.deepEqual(
    await repositoryViewerA.listForConversation(conversationA),
    messagesA
  );
  assert.deepEqual(await repositoryA.listForConversation(conversationB), []);
  assert.deepEqual(await repositoryB.listForConversation(conversationA), []);
  assert.deepEqual(await repositoryC.listForConversation(conversationA), []);

  const noSessionRepository = createPostgresConversationMessagesRepository(
    async () => null
  );
  await assert.rejects(
    noSessionRepository.listForConversation(conversationA),
    (error) => error instanceof AppError && error.code === 'unauthorized'
  );
  await assert.rejects(
    repositoryA.listForConversation('not-a-uuid'),
    (error) => error instanceof AppError && error.code === 'not_found'
  );

  const pooledIdentity = requireSuccess(
    await queryDb('SELECT auth.uid()::text AS user_id'),
    'pooled identity reset probe'
  );
  assert.deepEqual(pooledIdentity.rows, [{ user_id: null }]);

  const failClosed = requireSuccess(
    await queryDb(
      'SELECT id::text FROM public.messages WHERE conversation_id = ANY($1::uuid[])',
      [[conversationA, conversationB]]
    ),
    'missing identity RLS probe'
  );
  assert.deepEqual(failClosed.rows, []);

  console.log(
    'PostgreSQL conversation message history integration SUCCESS: NOBYPASSRLS role, viewer read, stable ascending history, cross-account denial, missing conversation, and transaction-local identity cleanup.'
  );
} finally {
  await pool.end();
}
