import assert from 'node:assert/strict';
import { Client } from 'pg';
import { AppError } from '../../src/lib/db/errors.ts';
import { queryDb, withTransaction } from '../../src/lib/db/postgres-client.ts';
import { getPostgresPool } from '../../src/lib/db/postgres-pool.ts';
import { createPostgresPipelineDealDeleteRepository } from '../../src/lib/repositories/pipeline-deal-delete.ts';

const ownerA = '00000000-0000-4000-8000-000000000001';
const ownerB = '00000000-0000-4000-8000-000000000002';
const viewerA = '00000000-0000-4000-8000-000000000003';
const agentA = '00000000-0000-4000-8000-000000000005';
const dealA = '70000000-0000-4000-8000-000000000001';
const dealA2 = '70000000-0000-4000-8000-000000000002';
const dealB = '70000000-0000-4000-8000-000000000006';
const dealCrossPipelineCreator = '70000000-0000-4000-8000-000000000007';
const dealCrossDealCreator = '70000000-0000-4000-8000-000000000008';
const pool = getPostgresPool();
const auditClient = new Client({
  connectionString: process.env.AUDIT_DATABASE_URL,
});
let auditConnected = false;

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

async function queryAs(userId, sql, values = []) {
  return withTransaction(async (transaction) => {
    await transaction.query(
      "SELECT set_config('request.jwt.claim.sub', $1, true)",
      [userId]
    );
    return transaction.query(sql, values);
  });
}

const inventorySql = `
  SELECT (SELECT count(*)::integer FROM public.deals) AS deals,
         (SELECT count(*)::integer FROM public.pipelines) AS pipelines,
         (SELECT count(*)::integer FROM public.pipeline_stages) AS stages,
         (SELECT count(*)::integer FROM public.contacts) AS contacts,
         (SELECT count(*)::integer FROM public.profiles) AS profiles`;

try {
  const runtime = requireSuccess(
    await queryDb(
      `SELECT current_user AS role,
              rolbypassrls,
              has_table_privilege(current_user, 'public.deals', 'SELECT') AS can_select,
              has_table_privilege(current_user, 'public.deals', 'DELETE') AS can_delete,
              has_table_privilege(current_user, 'public.deals', 'INSERT') AS can_insert,
              has_table_privilege(current_user, 'public.deals', 'UPDATE') AS can_update,
              has_table_privilege(current_user, 'public.pipeline_stages', 'SELECT') AS can_select_stages,
              has_table_privilege(current_user, 'public.contacts', 'SELECT') AS can_select_contacts
       FROM pg_roles
       WHERE rolname = current_user`
    ),
    'runtime role and privilege probe'
  );
  assert.deepEqual(runtime.rows, [
    {
      role: 'wacrm_pipeline_deal_delete_runtime',
      rolbypassrls: false,
      can_select: true,
      can_delete: true,
      can_insert: false,
      can_update: false,
      can_select_stages: false,
      can_select_contacts: false,
    },
  ]);

  await auditClient.connect();
  auditConnected = true;
  const auditRole = await auditClient.query('SELECT current_user AS role');
  assert.deepEqual(auditRole.rows, [
    { role: 'db_pipeline_deal_delete_bootstrap' },
  ]);

  const ownerRepository = createPostgresPipelineDealDeleteRepository(
    async () => ({ userId: ownerA })
  );
  const agentRepository = createPostgresPipelineDealDeleteRepository(
    async () => ({ userId: agentA })
  );
  const viewerRepository = createPostgresPipelineDealDeleteRepository(
    async () => ({ userId: viewerA })
  );

  const beforeInventory = await auditClient.query(inventorySql);
  const initialDeal = requireSuccess(
    await queryAs(
      ownerA,
      'SELECT id::text AS id, status FROM public.deals WHERE id = $1',
      [dealA]
    ),
    'target deal visibility'
  );
  assert.deepEqual(initialDeal.rows, [{ id: dealA, status: 'won' }]);

  await expectAppError(viewerRepository.deleteDeal(dealA), 'forbidden');
  await expectAppError(ownerRepository.deleteDeal(dealB), 'not_found');
  await expectAppError(
    ownerRepository.deleteDeal(dealCrossPipelineCreator),
    'not_found'
  );
  await expectAppError(
    ownerRepository.deleteDeal(dealCrossDealCreator),
    'not_found'
  );
  await expectAppError(ownerRepository.deleteDeal('invalid'), 'bad_request');

  await ownerRepository.deleteDeal(dealA);
  await agentRepository.deleteDeal(dealA2);
  await expectAppError(agentRepository.deleteDeal(dealA), 'not_found');

  const afterInventory = await auditClient.query(inventorySql);
  assert.deepEqual(afterInventory.rows, [
    {
      deals: beforeInventory.rows[0].deals - 2,
      pipelines: beforeInventory.rows[0].pipelines,
      stages: beforeInventory.rows[0].stages,
      contacts: beforeInventory.rows[0].contacts,
      profiles: beforeInventory.rows[0].profiles,
    },
  ]);

  const remainingAccountADeals = requireSuccess(
    await queryAs(
      ownerA,
      `SELECT id::text AS id FROM public.deals
       WHERE id IN ($1, $2, $3, $4)
       ORDER BY id`,
      [dealB, dealCrossPipelineCreator, dealCrossDealCreator, dealA]
    ),
    'unrelated deal rows preserved'
  );
  assert.deepEqual(remainingAccountADeals.rows, [
    { id: dealCrossPipelineCreator },
    { id: dealCrossDealCreator },
  ]);
  const accountBDeal = requireSuccess(
    await queryAs(
      ownerB,
      'SELECT id::text AS id FROM public.deals WHERE id = $1',
      [dealB]
    ),
    'other-account deal preserved'
  );
  assert.deepEqual(accountBDeal.rows, [{ id: dealB }]);

  const noSessionRepository = createPostgresPipelineDealDeleteRepository(
    async () => null
  );
  await expectAppError(noSessionRepository.deleteDeal(dealA), 'unauthorized');

  const pooledIdentity = requireSuccess(
    await queryDb('SELECT auth.uid()::text AS user_id'),
    'pooled identity reset probe'
  );
  assert.deepEqual(pooledIdentity.rows, [{ user_id: null }]);

  console.log(
    'PostgreSQL pipeline-deal-delete integration SUCCESS: NOBYPASSRLS runtime role, only needed runtime SELECT/DELETE grants, separate bootstrap audit connection for parent preservation, owner/agent success, viewer denial, account and creator isolation, one-row deletion, missing/invalid rejection, parent and unrelated deal preservation, fail-closed session, and transaction-local identity cleanup.'
  );
} finally {
  await pool.end();
  if (auditConnected) await auditClient.end();
}
