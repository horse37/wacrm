import assert from 'node:assert/strict';
import { AppError } from '../../src/lib/db/errors.ts';
import { queryDb, withTransaction } from '../../src/lib/db/postgres-client.ts';
import { getPostgresPool } from '../../src/lib/db/postgres-pool.ts';
import { createPostgresPipelineDealCreateRepository } from '../../src/lib/repositories/pipeline-deal-create.ts';

const ownerA = '00000000-0000-4000-8000-000000000001';
const viewerA = '00000000-0000-4000-8000-000000000003';
const agentA = '00000000-0000-4000-8000-000000000005';
const profileB = '90000000-0000-4000-8000-000000000002';
const accountA = '10000000-0000-4000-8000-000000000001';
const pipelineA = '50000000-0000-4000-8000-000000000001';
const pipelineB = '50000000-0000-4000-8000-000000000002';
const pipelineCrossCreator = '50000000-0000-4000-8000-000000000005';
const stageA = '60000000-0000-4000-8000-000000000001';
const stageB = '60000000-0000-4000-8000-000000000002';
const stageCrossCreator = '60000000-0000-4000-8000-000000000005';
const stageOtherPipeline = '60000000-0000-4000-8000-000000000003';
const contactA = '40000000-0000-4000-8000-000000000001';
const contactB = '40000000-0000-4000-8000-000000000002';
const pool = getPostgresPool();

function requireSuccess(result, label) {
  if (!result.ok) throw new Error(`${label} failed with ${result.error.code}`);
  return result.data;
}

async function expectAppError(promise, code) {
  await assert.rejects(
    promise,
    (error) => error instanceof AppError && error.code === code
  );
}

async function queryAs(userId, sql, values) {
  return withTransaction(async (transaction) => {
    await transaction.query(
      "SELECT set_config('request.jwt.claim.sub', $1, true)",
      [userId]
    );
    return transaction.query(sql, values);
  });
}

const baseInput = {
  title: '  Created in PostgreSQL  ',
  value: 987.65,
  currency: 'BRL',
  pipelineId: pipelineA,
  stageId: stageA,
  contactId: contactA,
  assignedTo: '90000000-0000-4000-8000-000000000001',
  notes: '  synthetic details  ',
  expectedCloseDate: '2026-10-30',
};

try {
  const runtime = requireSuccess(
    await queryDb(
      `SELECT current_user AS role,
              rolbypassrls,
              has_table_privilege(current_user, 'public.deals', 'INSERT') AS can_insert_table,
              has_column_privilege(current_user, 'public.deals', 'status', 'INSERT') AS can_insert_status,
              has_column_privilege(current_user, 'public.deals', 'notes', 'INSERT') AS can_insert_notes,
              has_column_privilege(current_user, 'public.deals', 'status', 'UPDATE') AS can_update_status
       FROM pg_roles
       WHERE rolname = current_user`
    ),
    'runtime role and insert-column probe'
  );
  assert.deepEqual(runtime.rows, [
    {
      role: 'wacrm_pipeline_deal_create_runtime',
      rolbypassrls: false,
      can_insert_table: false,
      can_insert_status: true,
      can_insert_notes: true,
      can_update_status: false,
    },
  ]);

  const ownerRepository = createPostgresPipelineDealCreateRepository(
    async () => ({ userId: ownerA })
  );
  const agentRepository = createPostgresPipelineDealCreateRepository(
    async () => ({ userId: agentA })
  );
  const viewerRepository = createPostgresPipelineDealCreateRepository(
    async () => ({ userId: viewerA })
  );

  const ownerDealId = await ownerRepository.createDeal({
    ...baseInput,
    status: 'won',
  });
  assert.match(ownerDealId, /^[0-9a-f-]{36}$/);
  const ownerDeal = requireSuccess(
    await queryAs(
      ownerA,
      `SELECT id::text AS id, user_id::text AS user_id, account_id::text AS account_id,
              pipeline_id::text AS pipeline_id, stage_id::text AS stage_id,
              contact_id::text AS contact_id, assigned_to::text AS assigned_to,
              title, value::text AS value, currency, notes,
              expected_close_date::text AS expected_close_date, status
       FROM public.deals WHERE id = $1`,
      [ownerDealId]
    ),
    'owner-created deal'
  );
  assert.deepEqual(ownerDeal.rows, [
    {
      id: ownerDealId,
      user_id: ownerA,
      account_id: accountA,
      pipeline_id: pipelineA,
      stage_id: stageA,
      contact_id: contactA,
      assigned_to: '90000000-0000-4000-8000-000000000001',
      title: 'Created in PostgreSQL',
      value: '987.65',
      currency: 'BRL',
      notes: 'synthetic details',
      expected_close_date: '2026-10-30',
      status: 'open',
    },
  ]);

  const agentDealId = await agentRepository.createDeal({
    ...baseInput,
    assignedTo: null,
    notes: null,
    expectedCloseDate: null,
  });
  const agentDeal = requireSuccess(
    await queryAs(
      agentA,
      'SELECT user_id::text AS user_id, account_id::text AS account_id, assigned_to, notes, expected_close_date::text AS expected_close_date, status FROM public.deals WHERE id = $1',
      [agentDealId]
    ),
    'agent-created deal'
  );
  assert.deepEqual(agentDeal.rows, [
    {
      user_id: agentA,
      account_id: accountA,
      assigned_to: null,
      notes: null,
      expected_close_date: null,
      status: 'open',
    },
  ]);

  await expectAppError(viewerRepository.createDeal(baseInput), 'forbidden');

  await expectAppError(
    ownerRepository.createDeal({
      ...baseInput,
      pipelineId: pipelineB,
      stageId: stageB,
      contactId: contactB,
      assignedTo: profileB,
    }),
    'not_found'
  );
  await expectAppError(
    ownerRepository.createDeal({ ...baseInput, stageId: stageOtherPipeline }),
    'not_found'
  );
  await expectAppError(
    ownerRepository.createDeal({ ...baseInput, contactId: contactB }),
    'not_found'
  );
  await expectAppError(
    ownerRepository.createDeal({ ...baseInput, assignedTo: profileB }),
    'not_found'
  );
  await expectAppError(
    ownerRepository.createDeal({
      ...baseInput,
      pipelineId: pipelineCrossCreator,
      stageId: stageCrossCreator,
    }),
    'not_found'
  );
  await expectAppError(
    ownerRepository.createDeal({ ...baseInput, value: 10_000_000_000 }),
    'bad_request'
  );
  await expectAppError(
    ownerRepository.createDeal({
      ...baseInput,
      expectedCloseDate: '2026-02-31',
    }),
    'bad_request'
  );

  const noSessionRepository = createPostgresPipelineDealCreateRepository(
    async () => null
  );
  await expectAppError(
    noSessionRepository.createDeal(baseInput),
    'unauthorized'
  );

  const pooledIdentity = requireSuccess(
    await queryDb('SELECT auth.uid()::text AS user_id'),
    'pooled identity reset probe'
  );
  assert.deepEqual(pooledIdentity.rows, [{ user_id: null }]);

  console.log(
    'PostgreSQL pipeline-deal-create integration SUCCESS: NOBYPASSRLS role, INSERT-only column grants, verified owner/agent identity, open status, field normalization, nullable values, viewer denial, pipeline/stage/contact/assignee/creator isolation, invalid-input rejection, fail-closed session, and transaction-local identity cleanup.'
  );
} finally {
  await pool.end();
}
