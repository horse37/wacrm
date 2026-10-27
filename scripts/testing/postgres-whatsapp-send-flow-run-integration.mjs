import assert from 'node:assert/strict';
import { queryDb, withTransaction } from '../../src/lib/db/postgres-client.ts';
import { getPostgresPool } from '../../src/lib/db/postgres-pool.ts';
import { createPostgresWhatsAppSendFlowRunRepository } from '../../src/lib/repositories/whatsapp-send-flow-run.ts';

const userOwner = '00000000-0000-4000-8000-000000000001';
const userViewer = '00000000-0000-4000-8000-000000000002';
const userOtherAccount = '00000000-0000-4000-8000-000000000003';
const accountA = '10000000-0000-4000-8000-000000000001';
const accountB = '10000000-0000-4000-8000-000000000002';
const contactA = '40000000-0000-4000-8000-000000000001';
const contactB = '40000000-0000-4000-8000-000000000002';
const contactOther = '40000000-0000-4000-8000-000000000003';
const contactCompleted = '40000000-0000-4000-8000-000000000004';
const runA = '70000000-0000-4000-8000-000000000001';
const runB = '70000000-0000-4000-8000-000000000002';
const runOther = '70000000-0000-4000-8000-000000000003';
const runCompleted = '70000000-0000-4000-8000-000000000004';
const endedAt = '2026-10-21T10:00:00.000Z';
const pool = getPostgresPool();

function requireSuccess(result, label) {
  if (!result.ok) throw new Error(`${label} failed with ${result.error.code}`);
  return result.data;
}

function repository(userId, accountId) {
  return createPostgresWhatsAppSendFlowRunRepository({ userId, accountId });
}

async function readRun(userId, accountId, runId) {
  return requireSuccess(
    await withTransaction(async (transaction) => {
      await transaction.query(
        "SELECT set_config('request.jwt.claim.sub', $1, true)",
        [userId]
      );
      return transaction.query(
        `SELECT id::text AS id, account_id::text AS account_id,
                contact_id::text AS contact_id, status,
                ended_at::text AS ended_at, end_reason
         FROM public.flow_runs
         WHERE id = $1::uuid AND account_id = $2::uuid`,
        [runId, accountId]
      );
    }),
    'flow run read'
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
    { role: 'wacrm_whatsapp_flow_run_runtime', rolbypassrls: false },
  ]);

  const rls = requireSuccess(
    await queryDb(
      `SELECT c.relname, c.relrowsecurity, c.relforcerowsecurity
       FROM pg_class AS c
       INNER JOIN pg_namespace AS n ON n.oid = c.relnamespace
       WHERE n.nspname = 'public' AND c.relname IN ('profiles', 'flow_runs')
       ORDER BY c.relname`
    ),
    'row-level security probe'
  );
  assert.deepEqual(rls.rows, [
    { relname: 'flow_runs', relrowsecurity: true, relforcerowsecurity: true },
    { relname: 'profiles', relrowsecurity: true, relforcerowsecurity: true },
  ]);

  assert.equal(
    await repository(userOwner, accountA).pauseActiveForAgentReply(
      contactA,
      endedAt
    ),
    true
  );
  const paused = await readRun(userOwner, accountA, runA);
  assert.equal(paused.rows.length, 1);
  assert.deepEqual(
    {
      status: paused.rows[0].status,
      end_reason: paused.rows[0].end_reason,
    },
    { status: 'paused_by_agent', end_reason: 'agent_replied' }
  );
  assert.equal(Date.parse(paused.rows[0].ended_at), Date.parse(endedAt));

  assert.equal(
    await repository(userViewer, accountA).pauseActiveForAgentReply(
      contactOther,
      endedAt
    ),
    false
  );
  assert.equal(
    await repository(userOwner, accountA).pauseActiveForAgentReply(
      contactB,
      endedAt
    ),
    false
  );
  assert.equal(
    await repository(userOwner, accountA).pauseActiveForAgentReply(
      contactCompleted,
      endedAt
    ),
    false
  );
  assert.equal(
    await repository(userOwner, accountA).pauseActiveForAgentReply(
      contactA,
      endedAt
    ),
    false
  );
  assert.equal(
    await repository(userOwner, accountA).pauseActiveForAgentReply(
      'not-a-uuid',
      endedAt
    ),
    false
  );

  const unchangedB = await readRun(userOtherAccount, accountB, runB);
  assert.deepEqual(
    {
      status: unchangedB.rows[0].status,
      end_reason: unchangedB.rows[0].end_reason,
    },
    { status: 'active', end_reason: null }
  );
  const unchangedOther = await readRun(userOwner, accountA, runOther);
  assert.deepEqual(
    {
      status: unchangedOther.rows[0].status,
      end_reason: unchangedOther.rows[0].end_reason,
    },
    { status: 'active', end_reason: null }
  );
  const unchangedCompleted = await readRun(userOwner, accountA, runCompleted);
  assert.deepEqual(
    {
      status: unchangedCompleted.rows[0].status,
      end_reason: unchangedCompleted.rows[0].end_reason,
    },
    { status: 'completed', end_reason: 'completed' }
  );

  const identity = requireSuccess(
    await withTransaction((transaction) =>
      transaction.query('SELECT auth.uid()::text AS identity')
    ),
    'transaction-local identity cleanup probe'
  );
  assert.deepEqual(identity.rows, [{ identity: null }]);
  console.log(
    'PASS: flow-run pause owner, viewer denial, account/contact/status isolation, persisted fields, forced RLS, and transaction-local identity cleanup'
  );
} finally {
  await pool.end();
}
