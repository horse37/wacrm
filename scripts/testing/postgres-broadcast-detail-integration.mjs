import assert from 'node:assert/strict';
import { AppError } from '../../src/lib/db/errors.ts';
import { queryDb } from '../../src/lib/db/postgres-client.ts';
import { getPostgresPool } from '../../src/lib/db/postgres-pool.ts';
import { createPostgresBroadcastDetailRepository } from '../../src/lib/repositories/broadcast-detail.ts';

const ownerA = '00000000-0000-4000-8000-000000000001';
const viewerA = '00000000-0000-4000-8000-000000000003';
const agentA = '00000000-0000-4000-8000-000000000005';
const ownerB = '00000000-0000-4000-8000-000000000002';
const adminC = '00000000-0000-4000-8000-000000000004';
const broadcastA = '30000000-0000-4000-8000-000000000003';
const broadcastB = '30000000-0000-4000-8000-000000000005';
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
    { role: 'wacrm_broadcast_detail_runtime', rolbypassrls: false },
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
          'profiles',
          'contacts',
          'broadcasts',
          'broadcast_recipients',
        ],
      ]
    ),
    'forced RLS probe'
  );
  assert.deepEqual(rls.rows, [
    {
      relname: 'accounts',
      relrowsecurity: true,
      relforcerowsecurity: true,
    },
    {
      relname: 'broadcast_recipients',
      relrowsecurity: true,
      relforcerowsecurity: true,
    },
    {
      relname: 'broadcasts',
      relrowsecurity: true,
      relforcerowsecurity: true,
    },
    {
      relname: 'contacts',
      relrowsecurity: true,
      relforcerowsecurity: true,
    },
    {
      relname: 'profiles',
      relrowsecurity: true,
      relforcerowsecurity: true,
    },
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
  const expectedColumns = [
    'accounts.id',
    'accounts.name',
    'profiles.user_id',
    'profiles.account_id',
    'profiles.account_role',
    'contacts.id',
    'contacts.account_id',
    'contacts.name',
    'contacts.phone',
    'broadcasts.id',
    'broadcasts.account_id',
    'broadcasts.user_id',
    'broadcasts.name',
    'broadcasts.template_name',
    'broadcasts.status',
    'broadcasts.total_recipients',
    'broadcasts.sent_count',
    'broadcasts.delivered_count',
    'broadcasts.read_count',
    'broadcasts.replied_count',
    'broadcasts.failed_count',
    'broadcasts.created_at',
    'broadcast_recipients.id',
    'broadcast_recipients.broadcast_id',
    'broadcast_recipients.contact_id',
    'broadcast_recipients.status',
    'broadcast_recipients.sent_at',
    'broadcast_recipients.delivered_at',
    'broadcast_recipients.read_at',
    'broadcast_recipients.replied_at',
    'broadcast_recipients.error_message',
    'broadcast_recipients.created_at',
  ].sort();
  const actualColumns = grants.rows.map(
    (row) => `${row.table_name}.${row.column_name}`
  );
  assert.deepEqual(actualColumns, expectedColumns);
  assert.ok(grants.rows.every((row) => row.privilege_type === 'SELECT'));

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
    createPostgresBroadcastDetailRepository(async () => ({ userId }));
  const detailA = await repositoryFor(ownerA).getForBroadcast(broadcastA);
  assert.deepEqual(detailA, {
    broadcast: {
      id: broadcastA,
      name: 'Synthetic campaign A',
      template_name: 'appointment_reminder',
      status: 'sending',
      total_recipients: 10,
      sent_count: 7,
      delivered_count: 4,
      read_count: 2,
      replied_count: 1,
      failed_count: 0,
      created_at: '2026-10-20T10:00:00.000Z',
    },
    recipients: [
      {
        id: '40000000-0000-4000-8000-000000000003',
        status: 'delivered',
        sent_at: '2026-10-20T10:01:00.000Z',
        delivered_at: '2026-10-20T10:02:00.000Z',
        read_at: null,
        replied_at: null,
        error_message: null,
        contact: { name: 'Synthetic Contact A', phone: '15550000001' },
      },
      {
        id: '40000000-0000-4000-8000-000000000002',
        status: 'failed',
        sent_at: null,
        delivered_at: null,
        read_at: null,
        replied_at: null,
        error_message: 'Synthetic delivery error',
        contact: null,
      },
      {
        id: '40000000-0000-4000-8000-000000000001',
        status: 'sent',
        sent_at: '2026-10-20T10:03:00.000Z',
        delivered_at: null,
        read_at: null,
        replied_at: null,
        error_message: null,
        contact: null,
      },
    ],
  });
  assert.deepEqual(Object.keys(detailA.broadcast).sort(), [
    'created_at',
    'delivered_count',
    'failed_count',
    'id',
    'name',
    'read_count',
    'replied_count',
    'sent_count',
    'status',
    'template_name',
    'total_recipients',
  ]);
  assert.deepEqual(Object.keys(detailA.recipients[0]).sort(), [
    'contact',
    'delivered_at',
    'error_message',
    'id',
    'read_at',
    'replied_at',
    'sent_at',
    'status',
  ]);
  for (const excludedValue of [
    'SYNTHETIC_TEMPLATE_VARIABLES_MUST_NOT_LEAK',
    'SYNTHETIC_AUDIENCE_FILTER_MUST_NOT_LEAK',
    'SYNTHETIC_WAMID_MUST_NOT_LEAK',
    'Synthetic Contact B',
    'synthetic-b@example.invalid',
    'Synthetic Company B',
  ]) {
    assert.equal(JSON.stringify(detailA).includes(excludedValue), false);
  }

  assert.deepEqual(
    await repositoryFor(viewerA).getForBroadcast(broadcastA),
    detailA
  );
  assert.deepEqual(
    await repositoryFor(agentA).getForBroadcast(broadcastA),
    detailA
  );
  await assert.rejects(
    repositoryFor(ownerB).getForBroadcast(broadcastA),
    (error) => error instanceof AppError && error.code === 'not_found'
  );
  await assert.rejects(
    repositoryFor(adminC).getForBroadcast(broadcastA),
    (error) => error instanceof AppError && error.code === 'not_found'
  );

  const detailB = await repositoryFor(ownerB).getForBroadcast(broadcastB);
  assert.equal(detailB.broadcast.id, broadcastB);
  assert.deepEqual(
    detailB.recipients.map((item) => item.id),
    ['40000000-0000-4000-8000-000000000005']
  );
  assert.deepEqual(detailB.recipients[0].contact, {
    name: 'Synthetic Contact B',
    phone: '15550000002',
  });

  await assert.rejects(
    repositoryFor(ownerA).getForBroadcast('bad-id'),
    (error) => error instanceof AppError && error.code === 'bad_request'
  );
  const noSessionRepository = createPostgresBroadcastDetailRepository(
    async () => null
  );
  await assert.rejects(
    noSessionRepository.getForBroadcast(broadcastA),
    (error) => error instanceof AppError && error.code === 'unauthorized'
  );

  const pooledIdentity = requireSuccess(
    await queryDb('SELECT auth.uid()::text AS user_id'),
    'pooled identity reset probe'
  );
  assert.deepEqual(pooledIdentity.rows, [{ user_id: null }]);

  const failClosedBroadcasts = requireSuccess(
    await queryDb('SELECT count(id)::int AS count FROM public.broadcasts'),
    'missing identity broadcasts RLS probe'
  );
  assert.deepEqual(failClosedBroadcasts.rows, [{ count: 0 }]);
  const failClosedRecipients = requireSuccess(
    await queryDb(
      'SELECT count(id)::int AS count FROM public.broadcast_recipients'
    ),
    'missing identity recipients RLS probe'
  );
  assert.deepEqual(failClosedRecipients.rows, [{ count: 0 }]);

  console.log(
    'PostgreSQL broadcast-detail integration SUCCESS: forced RLS, NOBYPASSRLS, exact minimum column SELECT grants, parent/creator/account/contact isolation, owner/agent/viewer access, complete deterministic recipient order, null contacts, UTC timestamps, sensitive-field omission, not-found/invalid-ID handling, and transaction-local identity cleanup.'
  );
} finally {
  await pool.end();
}
