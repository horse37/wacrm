import assert from 'node:assert/strict';
import { AppError } from '../../src/lib/db/errors.ts';
import { queryDb } from '../../src/lib/db/postgres-client.ts';
import { getPostgresPool } from '../../src/lib/db/postgres-pool.ts';
import { createPostgresMessageReactionTargetRepository } from '../../src/lib/repositories/message-reaction-target.ts';

const agentA = '00000000-0000-4000-8000-000000000003';
const viewerA = '00000000-0000-4000-8000-000000000004';
const messageA = '30000000-0000-4000-8000-000000000001';
const unsentMessageA = '30000000-0000-4000-8000-000000000002';
const noPhoneMessageA = '30000000-0000-4000-8000-000000000003';
const messageB = '30000000-0000-4000-8000-000000000004';
const inconsistentCreatorMessageA = '30000000-0000-4000-8000-000000000005';
const pool = getPostgresPool();

function requireSuccess(result, label) {
  if (!result.ok) throw new Error(`${label} failed with ${result.error.code}`);
  return result.data;
}

function repositoryFor(userId) {
  return createPostgresMessageReactionTargetRepository(async () => ({
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
    { role: 'wacrm_message_reaction_target_runtime', rolbypassrls: false },
  ]);

  const rls = requireSuccess(
    await queryDb(
      `SELECT c.relname, c.relrowsecurity, c.relforcerowsecurity
       FROM pg_class AS c
       INNER JOIN pg_namespace AS n ON n.oid = c.relnamespace
       WHERE n.nspname = 'public'
         AND c.relname = ANY($1::text[])
       ORDER BY c.relname`,
      [['accounts', 'contacts', 'conversations', 'messages', 'profiles']]
    ),
    'forced RLS probe'
  );
  assert.deepEqual(
    rls.rows,
    ['accounts', 'contacts', 'conversations', 'messages', 'profiles'].map(
      (relname) => ({
        relname,
        relrowsecurity: true,
        relforcerowsecurity: true,
      })
    )
  );

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
      'contacts.account_id',
      'contacts.id',
      'contacts.phone',
      'conversations.account_id',
      'conversations.contact_id',
      'conversations.id',
      'conversations.user_id',
      'messages.conversation_id',
      'messages.id',
      'messages.message_id',
      'profiles.account_id',
      'profiles.account_role',
      'profiles.user_id',
    ].map((column) => `SELECT:${column}`),
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
  assert.deepEqual(tableGrants.rows, []);

  await assert.rejects(
    createPostgresMessageReactionTargetRepository(async () => null).getTarget(
      messageA
    ),
    (error) => error instanceof AppError && error.code === 'unauthorized'
  );
  await assert.rejects(
    repositoryFor(viewerA).getTarget(messageA),
    (error) => error instanceof AppError && error.code === 'forbidden'
  );
  await assert.rejects(
    repositoryFor(agentA).getTarget('../invalid-message-id'),
    (error) => error instanceof AppError && error.code === 'bad_request'
  );

  const target = await repositoryFor(agentA).getTarget(messageA);
  assert.deepEqual(target, {
    providerMessageId: 'SYNTHETIC_PROVIDER_MESSAGE_A',
    contactPhone: '+15555550123',
  });
  await assert.rejects(
    repositoryFor(agentA).getTarget(messageB),
    (error) => error instanceof AppError && error.code === 'not_found'
  );
  assert.deepEqual(await repositoryFor(agentA).getTarget(unsentMessageA), {
    providerMessageId: null,
    contactPhone: '+15555550123',
  });
  assert.deepEqual(await repositoryFor(agentA).getTarget(noPhoneMessageA), {
    providerMessageId: 'SYNTHETIC_NO_PHONE_PROVIDER_ID',
    contactPhone: null,
  });
  await assert.rejects(
    repositoryFor(agentA).getTarget(inconsistentCreatorMessageA),
    (error) => error instanceof AppError && error.code === 'not_found'
  );

  const pooledIdentity = requireSuccess(
    await queryDb('SELECT auth.uid()::text AS user_id'),
    'pooled identity reset probe'
  );
  assert.deepEqual(pooledIdentity.rows, [{ user_id: null }]);
  const noIdentity = requireSuccess(
    await queryDb(
      'SELECT count(message.id)::int AS count FROM public.messages AS message'
    ),
    'missing identity RLS probe'
  );
  assert.deepEqual(noIdentity.rows, [{ count: 0 }]);

  console.log(
    'PostgreSQL message-reaction target integration SUCCESS: forced RLS, NOBYPASSRLS, exact minimum grants, agent authorization, account/contact/creator isolation, unsent/missing-phone guards, minimal target DTO, and identity cleanup.'
  );
} finally {
  await pool.end();
}
