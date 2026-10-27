import assert from 'node:assert/strict';
import { AppError } from '../../src/lib/db/errors.ts';
import { queryDb, withTransaction } from '../../src/lib/db/postgres-client.ts';
import { getPostgresPool } from '../../src/lib/db/postgres-pool.ts';
import { createPostgresPipelineDealDetailsUpdateRepository } from '../../src/lib/repositories/pipeline-deal-details-update.ts';

const ownerA = '00000000-0000-4000-8000-000000000001';
const viewerA = '00000000-0000-4000-8000-000000000003';
const agentA = '00000000-0000-4000-8000-000000000005';
const accountA = '10000000-0000-4000-8000-000000000001';
const dealA = '70000000-0000-4000-8000-000000000001';
const dealB = '70000000-0000-4000-8000-000000000006';
const dealCrossPipelineCreator = '70000000-0000-4000-8000-000000000007';
const dealCrossDealCreator = '70000000-0000-4000-8000-000000000008';
const pipelineA = '50000000-0000-4000-8000-000000000001';
const pipelineB = '50000000-0000-4000-8000-000000000002';
const stageA = '60000000-0000-4000-8000-000000000001';
const stageATarget = '60000000-0000-4000-8000-000000000006';
const stageOtherPipeline = '60000000-0000-4000-8000-000000000003';
const stageB = '60000000-0000-4000-8000-000000000002';
const stageCrossCreator = '60000000-0000-4000-8000-000000000005';
const contactA = '40000000-0000-4000-8000-000000000001';
const contactB = '40000000-0000-4000-8000-000000000002';
const profileA = '90000000-0000-4000-8000-000000000001';
const profileB = '90000000-0000-4000-8000-000000000002';
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

function updateInput(overrides = {}) {
  return {
    dealId: dealA,
    pipelineId: pipelineA,
    stageId: stageATarget,
    contactId: contactA,
    assignedTo: profileA,
    title: 'Updated synthetic deal',
    value: 777.25,
    currency: 'EUR',
    notes: 'Updated synthetic note',
    expectedCloseDate: '2026-11-02',
    ...overrides,
  };
}

try {
  const runtime = requireSuccess(
    await queryDb(
      `SELECT current_user AS role,
              rolbypassrls,
              has_table_privilege(current_user, 'public.deals', 'UPDATE') AS can_update_table,
              has_column_privilege(current_user, 'public.deals', 'notes', 'UPDATE') AS can_update_notes,
              has_column_privilege(current_user, 'public.deals', 'status', 'UPDATE') AS can_update_status,
              has_column_privilege(current_user, 'public.deals', 'pipeline_id', 'UPDATE') AS can_update_pipeline
       FROM pg_roles
       WHERE rolname = current_user`
    ),
    'runtime role and update-column probe'
  );
  assert.deepEqual(runtime.rows, [
    {
      role: 'wacrm_pipeline_deal_details_update_runtime',
      rolbypassrls: false,
      can_update_table: false,
      can_update_notes: true,
      can_update_status: false,
      can_update_pipeline: false,
    },
  ]);

  const ownerRepository = createPostgresPipelineDealDetailsUpdateRepository(
    async () => ({ userId: ownerA })
  );
  const agentRepository = createPostgresPipelineDealDetailsUpdateRepository(
    async () => ({ userId: agentA })
  );
  const viewerRepository = createPostgresPipelineDealDetailsUpdateRepository(
    async () => ({ userId: viewerA })
  );

  const initial = requireSuccess(
    await queryAs(
      ownerA,
      `SELECT id::text AS id, user_id::text AS user_id, account_id::text AS account_id,
              pipeline_id::text AS pipeline_id, stage_id::text AS stage_id,
              contact_id::text AS contact_id, assigned_to::text AS assigned_to,
              title, value::text AS value, currency, notes, status,
              expected_close_date::text AS expected_close_date, updated_at::text AS updated_at
       FROM public.deals WHERE id = $1`,
      [dealA]
    ),
    'initial deal state'
  );
  assert.equal(initial.rows[0].status, 'won');

  await ownerRepository.updateDetails(updateInput());
  let updated = requireSuccess(
    await queryAs(
      ownerA,
      `SELECT id::text AS id, user_id::text AS user_id, account_id::text AS account_id,
              pipeline_id::text AS pipeline_id, stage_id::text AS stage_id,
              contact_id::text AS contact_id, assigned_to::text AS assigned_to,
              title, value::text AS value, currency, notes, status,
              expected_close_date::text AS expected_close_date, updated_at::text AS updated_at
       FROM public.deals WHERE id = $1`,
      [dealA]
    ),
    'owner updated deal'
  );
  assert.deepEqual(
    {
      id: updated.rows[0].id,
      user_id: updated.rows[0].user_id,
      account_id: updated.rows[0].account_id,
      pipeline_id: updated.rows[0].pipeline_id,
      stage_id: updated.rows[0].stage_id,
      contact_id: updated.rows[0].contact_id,
      assigned_to: updated.rows[0].assigned_to,
      title: updated.rows[0].title,
      value: updated.rows[0].value,
      currency: updated.rows[0].currency,
      notes: updated.rows[0].notes,
      status: updated.rows[0].status,
      expected_close_date: updated.rows[0].expected_close_date,
    },
    {
      id: dealA,
      user_id: ownerA,
      account_id: accountA,
      pipeline_id: pipelineA,
      stage_id: stageATarget,
      contact_id: contactA,
      assigned_to: profileA,
      title: 'Updated synthetic deal',
      value: '777.25',
      currency: 'EUR',
      notes: 'Updated synthetic note',
      status: 'won',
      expected_close_date: '2026-11-02',
    }
  );
  assert.notEqual(updated.rows[0].updated_at, initial.rows[0].updated_at);

  await agentRepository.updateDetails(
    updateInput({
      stageId: stageA,
      assignedTo: null,
      notes: null,
      expectedCloseDate: null,
    })
  );
  updated = requireSuccess(
    await queryAs(
      ownerA,
      'SELECT stage_id::text AS stage_id, assigned_to, notes, expected_close_date::text AS expected_close_date, status FROM public.deals WHERE id = $1',
      [dealA]
    ),
    'agent updated nullable deal fields'
  );
  assert.deepEqual(updated.rows, [
    {
      stage_id: stageA,
      assigned_to: null,
      notes: null,
      expected_close_date: null,
      status: 'won',
    },
  ]);

  await expectAppError(
    viewerRepository.updateDetails(updateInput()),
    'forbidden'
  );
  await expectAppError(
    ownerRepository.updateDetails(
      updateInput({
        dealId: dealB,
        pipelineId: pipelineB,
        stageId: stageB,
        contactId: contactB,
        assignedTo: profileB,
      })
    ),
    'not_found'
  );
  await expectAppError(
    ownerRepository.updateDetails(updateInput({ pipelineId: pipelineB })),
    'not_found'
  );
  await expectAppError(
    ownerRepository.updateDetails(updateInput({ stageId: stageOtherPipeline })),
    'not_found'
  );
  await expectAppError(
    ownerRepository.updateDetails(updateInput({ contactId: contactB })),
    'not_found'
  );
  await expectAppError(
    ownerRepository.updateDetails(updateInput({ assignedTo: profileB })),
    'not_found'
  );
  await expectAppError(
    ownerRepository.updateDetails(
      updateInput({
        dealId: dealCrossPipelineCreator,
        stageId: stageCrossCreator,
      })
    ),
    'not_found'
  );
  await expectAppError(
    ownerRepository.updateDetails(
      updateInput({ dealId: dealCrossDealCreator, stageId: stageA })
    ),
    'not_found'
  );
  await expectAppError(
    ownerRepository.updateDetails(updateInput({ value: 10_000_000_000 })),
    'bad_request'
  );
  await expectAppError(
    ownerRepository.updateDetails(
      updateInput({ expectedCloseDate: '2026-02-31' })
    ),
    'bad_request'
  );

  const noSessionRepository = createPostgresPipelineDealDetailsUpdateRepository(
    async () => null
  );
  await expectAppError(
    noSessionRepository.updateDetails(updateInput()),
    'unauthorized'
  );

  const pooledIdentity = requireSuccess(
    await queryDb('SELECT auth.uid()::text AS user_id'),
    'pooled identity reset probe'
  );
  assert.deepEqual(pooledIdentity.rows, [{ user_id: null }]);

  console.log(
    'PostgreSQL pipeline-deal-details-update integration SUCCESS: NOBYPASSRLS role, update-column-only grants, owner/agent success, status/pipeline/account/creator preservation, viewer denial, pipeline/stage/contact/assignee/creator isolation, nullable fields, date/value rejection, updated_at trigger, fail-closed session, and transaction-local identity cleanup.'
  );
} finally {
  await pool.end();
}
