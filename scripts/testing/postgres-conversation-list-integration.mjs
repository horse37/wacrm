import assert from 'node:assert/strict';
import { AppError } from '../../src/lib/db/errors.ts';
import { queryDb } from '../../src/lib/db/postgres-client.ts';
import { getPostgresPool } from '../../src/lib/db/postgres-pool.ts';
import { createPostgresConversationListRepository } from '../../src/lib/repositories/conversation-list.ts';
import { createPostgresWhatsAppSendConversationRepository } from '../../src/lib/repositories/whatsapp-send-conversation.ts';

const ownerA = '00000000-0000-4000-8000-000000000001';
const viewerA = '00000000-0000-4000-8000-000000000003';
const ownerB = '00000000-0000-4000-8000-000000000002';
const ownerC = '00000000-0000-4000-8000-000000000004';
const accountA = '10000000-0000-4000-8000-000000000001';
const accountB = '10000000-0000-4000-8000-000000000002';
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
    { role: 'wacrm_conversation_list_runtime', rolbypassrls: false },
  ]);

  const repositoryA = createPostgresConversationListRepository(async () => ({
    userId: ownerA,
  }));
  const repositoryViewerA = createPostgresConversationListRepository(
    async () => ({ userId: viewerA })
  );
  const repositoryB = createPostgresConversationListRepository(async () => ({
    userId: ownerB,
  }));
  const repositoryC = createPostgresConversationListRepository(async () => ({
    userId: ownerC,
  }));

  const conversationsA = await repositoryA.listConversations();
  assert.deepEqual(
    conversationsA.map((conversation) => conversation.id),
    [
      '20000000-0000-4000-8000-000000000002',
      '20000000-0000-4000-8000-000000000001',
      '20000000-0000-4000-8000-000000000003',
    ]
  );
  assert.equal(conversationsA[0].last_message_at, undefined);
  assert.equal(conversationsA[0].assigned_agent_id, ownerA);
  assert.equal(conversationsA[0].contact?.name, 'Synthetic contact A2');
  assert.equal(conversationsA[0].contact?.phone_normalized, '15550000002');
  assert.equal(conversationsA[0].unread_count, 0);
  assert.equal(conversationsA[2].unread_count, 0);
  assert.deepEqual(await repositoryViewerA.listConversations(), conversationsA);

  const conversationsB = await repositoryB.listConversations();
  assert.deepEqual(
    conversationsB.map((conversation) => conversation.id),
    ['20000000-0000-4000-8000-000000000004']
  );
  assert.deepEqual(await repositoryC.listConversations(), []);

  const sendLookupA = createPostgresWhatsAppSendConversationRepository({
    userId: ownerA,
    accountId: accountA,
  });
  assert.deepEqual(
    await sendLookupA.findForSend('20000000-0000-4000-8000-000000000001'),
    {
      contact: {
        id: '40000000-0000-4000-8000-000000000001',
        phone: '+1 (555) 000-0001',
      },
    }
  );
  assert.equal(
    await sendLookupA.findForSend('20000000-0000-4000-8000-000000000004'),
    null
  );

  const crossAccountLookup = createPostgresWhatsAppSendConversationRepository({
    userId: ownerA,
    accountId: accountB,
  });
  assert.equal(
    await crossAccountLookup.findForSend(
      '20000000-0000-4000-8000-000000000004'
    ),
    null
  );

  const noSessionRepository = createPostgresConversationListRepository(
    async () => null
  );
  await assert.rejects(
    noSessionRepository.listConversations(),
    (error) => error instanceof AppError && error.code === 'unauthorized'
  );

  const pooledIdentity = requireSuccess(
    await queryDb('SELECT auth.uid()::text AS user_id'),
    'pooled identity reset probe'
  );
  assert.deepEqual(pooledIdentity.rows, [{ user_id: null }]);

  const failClosed = requireSuccess(
    await queryDb(
      `SELECT
         (SELECT count(*)::int FROM public.conversations) AS conversations,
         (SELECT count(*)::int FROM public.contacts) AS contacts`
    ),
    'missing identity RLS probe'
  );
  assert.deepEqual(failClosed.rows, [{ conversations: 0, contacts: 0 }]);

  console.log(
    'PostgreSQL conversation list/send lookup integration SUCCESS: NOBYPASSRLS role, viewer projection, tenant-scoped send target, cross-account RLS isolation, null-first descending order, empty account, and transaction-local identity cleanup.'
  );
} finally {
  await pool.end();
}
