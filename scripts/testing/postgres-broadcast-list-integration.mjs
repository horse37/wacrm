import assert from 'node:assert/strict';
import { AppError } from '../../src/lib/db/errors.ts';
import { queryDb } from '../../src/lib/db/postgres-client.ts';
import { getPostgresPool } from '../../src/lib/db/postgres-pool.ts';
import { createPostgresBroadcastListRepository } from '../../src/lib/repositories/broadcast-list.ts';

const ownerA = '00000000-0000-4000-8000-000000000001';
const viewerA = '00000000-0000-4000-8000-000000000003';
const agentA = '00000000-0000-4000-8000-000000000005';
const ownerB = '00000000-0000-4000-8000-000000000002';
const adminC = '00000000-0000-4000-8000-000000000004';
const pool = getPostgresPool();

function requireSuccess(result, label) {
  if (!result.ok) throw new Error(`${label} failed with ${result.error.code}`);
  return result.data;
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
    { role: 'wacrm_broadcast_list_runtime', rolbypassrls: false },
  ]);

  const rls = requireSuccess(
    await queryDb(
      `SELECT c.relname, c.relrowsecurity, c.relforcerowsecurity
       FROM pg_class AS c
       INNER JOIN pg_namespace AS n ON n.oid = c.relnamespace
       WHERE n.nspname = 'public'
         AND c.relname = ANY($1::text[])
       ORDER BY c.relname`,
      [['accounts', 'profiles', 'broadcasts']]
    ),
    'forced RLS probe'
  );
  assert.deepEqual(rls.rows, [
    { relname: 'accounts', relrowsecurity: true, relforcerowsecurity: true },
    { relname: 'broadcasts', relrowsecurity: true, relforcerowsecurity: true },
    { relname: 'profiles', relrowsecurity: true, relforcerowsecurity: true },
  ]);

  const grants = requireSuccess(
    await queryDb(
      `SELECT table_name, column_name, privilege_type
       FROM information_schema.role_column_grants
       WHERE grantee = current_user AND table_schema = 'public'
       ORDER BY table_name, column_name`
    ),
    'runtime column grant probe'
  );
  assert.deepEqual(grants.rows, [
    { table_name: 'accounts', column_name: 'id', privilege_type: 'SELECT' },
    { table_name: 'accounts', column_name: 'name', privilege_type: 'SELECT' },
    {
      table_name: 'broadcasts',
      column_name: 'account_id',
      privilege_type: 'SELECT',
    },
    {
      table_name: 'broadcasts',
      column_name: 'created_at',
      privilege_type: 'SELECT',
    },
    {
      table_name: 'broadcasts',
      column_name: 'delivered_count',
      privilege_type: 'SELECT',
    },
    { table_name: 'broadcasts', column_name: 'id', privilege_type: 'SELECT' },
    { table_name: 'broadcasts', column_name: 'name', privilege_type: 'SELECT' },
    {
      table_name: 'broadcasts',
      column_name: 'read_count',
      privilege_type: 'SELECT',
    },
    {
      table_name: 'broadcasts',
      column_name: 'status',
      privilege_type: 'SELECT',
    },
    {
      table_name: 'broadcasts',
      column_name: 'template_name',
      privilege_type: 'SELECT',
    },
    {
      table_name: 'broadcasts',
      column_name: 'total_recipients',
      privilege_type: 'SELECT',
    },
    {
      table_name: 'broadcasts',
      column_name: 'user_id',
      privilege_type: 'SELECT',
    },
    {
      table_name: 'profiles',
      column_name: 'account_id',
      privilege_type: 'SELECT',
    },
    {
      table_name: 'profiles',
      column_name: 'account_role',
      privilege_type: 'SELECT',
    },
    {
      table_name: 'profiles',
      column_name: 'user_id',
      privilege_type: 'SELECT',
    },
  ]);

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

  const repositoryFor = (userId) =>
    createPostgresBroadcastListRepository(async () => ({ userId }));
  const listA = await repositoryFor(ownerA).listForCurrentAccount();
  assert.deepEqual(listA, [
    {
      id: '30000000-0000-4000-8000-000000000003',
      name: 'Newest A tie',
      template_name: 'appointment_reminder',
      status: 'sending',
      total_recipients: 10,
      delivered_count: 4,
      read_count: 2,
      created_at: '2026-10-20T10:00:00.000Z',
    },
    {
      id: '30000000-0000-4000-8000-000000000001',
      name: 'Newest A',
      template_name: 'new_listing',
      status: 'sent',
      total_recipients: 0,
      delivered_count: 0,
      read_count: 0,
      created_at: '2026-10-20T10:00:00.000Z',
    },
    {
      id: '30000000-0000-4000-8000-000000000002',
      name: 'Older A',
      template_name: 'open_house',
      status: 'draft',
      total_recipients: 5,
      delivered_count: 0,
      read_count: 0,
      created_at: '2026-10-19T10:00:00.000Z',
    },
  ]);
  assert.deepEqual(Object.keys(listA[0]).sort(), [
    'created_at',
    'delivered_count',
    'id',
    'name',
    'read_count',
    'status',
    'template_name',
    'total_recipients',
  ]);
  assert.equal(
    JSON.stringify(listA).includes(
      'SYNTHETIC_TEMPLATE_VARIABLES_MUST_NOT_LEAK'
    ),
    false
  );
  assert.equal(
    JSON.stringify(listA).includes('SYNTHETIC_AUDIENCE_FILTER_MUST_NOT_LEAK'),
    false
  );
  assert.deepEqual(await repositoryFor(viewerA).listForCurrentAccount(), listA);
  assert.deepEqual(await repositoryFor(agentA).listForCurrentAccount(), listA);
  assert.deepEqual(
    (await repositoryFor(ownerB).listForCurrentAccount()).map(
      (item) => item.id
    ),
    ['30000000-0000-4000-8000-000000000005']
  );
  assert.deepEqual(await repositoryFor(adminC).listForCurrentAccount(), []);

  const noSessionRepository = createPostgresBroadcastListRepository(
    async () => null
  );
  await assert.rejects(
    noSessionRepository.listForCurrentAccount(),
    (error) => error instanceof AppError && error.code === 'unauthorized'
  );

  const pooledIdentity = requireSuccess(
    await queryDb('SELECT auth.uid()::text AS user_id'),
    'pooled identity reset probe'
  );
  assert.deepEqual(pooledIdentity.rows, [{ user_id: null }]);

  const failClosed = requireSuccess(
    await queryDb('SELECT count(*)::int AS count FROM public.broadcasts'),
    'missing identity RLS probe'
  );
  assert.deepEqual(failClosed.rows, [{ count: 0 }]);

  console.log(
    'PostgreSQL broadcast-list integration SUCCESS: forced RLS, NOBYPASSRLS, exact minimum column SELECT grants, account and creator isolation, owner/agent/viewer access, stable unbounded ordering, UTC timestamps, sensitive-field omission, empty account, and transaction-local identity cleanup.'
  );
} finally {
  await pool.end();
}
