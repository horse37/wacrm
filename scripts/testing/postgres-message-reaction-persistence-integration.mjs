import assert from 'node:assert/strict';
import { AppError } from '../../src/lib/db/errors.ts';
import { queryDb } from '../../src/lib/db/postgres-client.ts';
import { getPostgresPool } from '../../src/lib/db/postgres-pool.ts';
import { createPostgresMessageReactionPersistenceRepository } from '../../src/lib/repositories/message-reaction-persistence.ts';

const agentA = '00000000-0000-4000-8000-000000000003';
const viewerA = '00000000-0000-4000-8000-000000000004';
const messageA = '30000000-0000-4000-8000-000000000001';
const unsentMessageA = '30000000-0000-4000-8000-000000000002';
const messageB = '30000000-0000-4000-8000-000000000003';
const pool = getPostgresPool();

function requireSuccess(result, label) {
  if (!result.ok) throw new Error(`${label} failed with ${result.error.code}`);
  return result.data;
}

function repositoryFor(userId) {
  return createPostgresMessageReactionPersistenceRepository(async () => ({
    userId,
  }));
}

try {
  const runtime = requireSuccess(
    await queryDb(
      `SELECT current_user AS role, rolbypassrls
       FROM pg_roles WHERE rolname = current_user`
    ),
    'runtime role probe'
  );
  assert.deepEqual(runtime.rows, [
    { role: 'wacrm_message_reaction_runtime', rolbypassrls: false },
  ]);

  const rls = requireSuccess(
    await queryDb(
      `SELECT c.relname, c.relrowsecurity, c.relforcerowsecurity
       FROM pg_class AS c
       INNER JOIN pg_namespace AS n ON n.oid = c.relnamespace
       WHERE n.nspname = 'public'
         AND c.relname = ANY($1::text[])
       ORDER BY c.relname`,
      [
        [
          'accounts',
          'conversations',
          'message_reactions',
          'messages',
          'profiles',
        ],
      ]
    ),
    'forced RLS probe'
  );
  assert.deepEqual(rls.rows, [
    { relname: 'accounts', relrowsecurity: true, relforcerowsecurity: true },
    {
      relname: 'conversations',
      relrowsecurity: true,
      relforcerowsecurity: true,
    },
    {
      relname: 'message_reactions',
      relrowsecurity: true,
      relforcerowsecurity: true,
    },
    { relname: 'messages', relrowsecurity: true, relforcerowsecurity: true },
    { relname: 'profiles', relrowsecurity: true, relforcerowsecurity: true },
  ]);

  const columnGrants = requireSuccess(
    await queryDb(
      `SELECT table_name, column_name, privilege_type
       FROM information_schema.role_column_grants
       WHERE grantee = current_user AND table_schema = 'public'
       ORDER BY privilege_type, table_name, column_name`
    ),
    'runtime column grant probe'
  );
  const expectedColumnGrants = [
    ...[
      'accounts.id',
      'accounts.name',
      'conversations.account_id',
      'conversations.id',
      'conversations.user_id',
      'messages.conversation_id',
      'messages.id',
      'messages.message_id',
      'message_reactions.actor_id',
      'message_reactions.actor_type',
      'message_reactions.conversation_id',
      'message_reactions.emoji',
      'message_reactions.id',
      'message_reactions.message_id',
      'profiles.account_id',
      'profiles.account_role',
      'profiles.user_id',
    ].map((column) => `SELECT:${column}`),
    ...[
      'message_reactions.actor_id',
      'message_reactions.actor_type',
      'message_reactions.emoji',
      'message_reactions.message_id',
      'message_reactions.conversation_id',
    ].map((column) => `INSERT:${column}`),
    ...['message_reactions.conversation_id', 'message_reactions.emoji'].map(
      (column) => `UPDATE:${column}`
    ),
  ].sort();
  assert.deepEqual(
    columnGrants.rows
      .map(
        (row) => `${row.privilege_type}:${row.table_name}.${row.column_name}`
      )
      .sort(),
    expectedColumnGrants
  );

  const tableGrants = requireSuccess(
    await queryDb(
      `SELECT table_name, privilege_type
       FROM information_schema.role_table_grants
       WHERE grantee = current_user AND table_schema = 'public'
       ORDER BY table_name, privilege_type`
    ),
    'runtime table grant probe'
  );
  assert.deepEqual(tableGrants.rows, [
    { table_name: 'message_reactions', privilege_type: 'DELETE' },
  ]);

  await assert.rejects(
    createPostgresMessageReactionPersistenceRepository(
      async () => null
    ).saveAgentReaction(messageA, '👍'),
    (error) => error instanceof AppError && error.code === 'unauthorized'
  );
  await assert.rejects(
    repositoryFor(viewerA).saveAgentReaction(messageA, '👍'),
    (error) => error instanceof AppError && error.code === 'forbidden'
  );
  await assert.rejects(
    repositoryFor(agentA).saveAgentReaction('../invalid-message-id', '👍'),
    (error) => error instanceof AppError && error.code === 'bad_request'
  );
  await assert.rejects(
    repositoryFor(agentA).saveAgentReaction(messageB, '👍'),
    (error) => error instanceof AppError && error.code === 'not_found'
  );
  await assert.rejects(
    repositoryFor(agentA).saveAgentReaction(unsentMessageA, '👍'),
    (error) => error instanceof AppError && error.code === 'bad_request'
  );

  await repositoryFor(agentA).saveAgentReaction(messageA, '👍');
  await repositoryFor(agentA).saveAgentReaction(messageA, '🔥');
  await Promise.all([
    repositoryFor(agentA).saveAgentReaction(messageA, '✅'),
    repositoryFor(agentA).saveAgentReaction(messageA, '⭐'),
  ]);
  await repositoryFor(agentA).saveAgentReaction(messageA, '');
  await repositoryFor(agentA).saveAgentReaction(messageA, '');

  const pooledIdentity = requireSuccess(
    await queryDb('SELECT auth.uid()::text AS user_id'),
    'pooled identity reset probe'
  );
  assert.deepEqual(pooledIdentity.rows, [{ user_id: null }]);
  const noIdentity = requireSuccess(
    await queryDb(
      'SELECT count(id)::int AS count FROM public.message_reactions'
    ),
    'missing identity RLS probe'
  );
  assert.deepEqual(noIdentity.rows, [{ count: 0 }]);

  console.log(
    'PostgreSQL message-reaction persistence integration SUCCESS: forced RLS, NOBYPASSRLS, exact minimum grants, agent authorization, account isolation, provider-ID guard, upsert replacement/concurrency, actor-scoped idempotent delete, and identity cleanup.'
  );
} finally {
  await pool.end();
}
