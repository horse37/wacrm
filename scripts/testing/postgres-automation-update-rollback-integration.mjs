import assert from 'node:assert/strict';
import { AppError } from '../../src/lib/db/errors.ts';
import { withTransaction } from '../../src/lib/db/postgres-client.ts';
import { getPostgresPool } from '../../src/lib/db/postgres-pool.ts';
import { createPostgresAutomationUpdatePersistenceRepository } from '../../src/lib/repositories/automation-update-persistence.ts';

const agentA = '00000000-0000-4000-8000-000000000003';
const activeId = '30000000-0000-4000-8000-000000000001';
const pool = getPostgresPool();

function requireSuccess(result, label) {
  if (!result.ok) throw new Error(`${label} failed with ${result.error.code}`);
  return result.data;
}

async function scopedRows(sql, values = []) {
  return requireSuccess(
    await withTransaction(async (transaction) => {
      await transaction.query(
        "SELECT set_config('request.jwt.claim.sub', $1, true)",
        [agentA]
      );
      return transaction.query(sql, values);
    }),
    'scoped rollback verification'
  ).rows;
}

try {
  const originalAutomation = await scopedRows(
    `SELECT name, is_active FROM public.automations WHERE id = $1`,
    [activeId]
  );
  const originalSteps = await scopedRows(
    `SELECT id::text AS id, parent_step_id::text AS parent_step_id,
            branch, step_type, step_config, position
     FROM public.automation_steps WHERE automation_id = $1
     ORDER BY parent_step_id NULLS FIRST, branch, position, id`,
    [activeId]
  );

  await assert.rejects(
    createPostgresAutomationUpdatePersistenceRepository(async () => ({
      userId: agentA,
    })).patchOwnedAutomation(activeId, {
      name: 'Synthetic rollback candidate',
      is_active: false,
      steps: [{ step_type: 'synthetic_reject', step_config: {} }],
    }),
    (error) => error instanceof AppError && error.code === 'db_error'
  );

  assert.deepEqual(
    await scopedRows(
      `SELECT name, is_active FROM public.automations WHERE id = $1`,
      [activeId]
    ),
    originalAutomation
  );
  assert.deepEqual(
    await scopedRows(
      `SELECT id::text AS id, parent_step_id::text AS parent_step_id,
              branch, step_type, step_config, position
       FROM public.automation_steps WHERE automation_id = $1
       ORDER BY parent_step_id NULLS FIRST, branch, position, id`,
      [activeId]
    ),
    originalSteps
  );

  console.log(
    'PostgreSQL automation-update rollback probe SUCCESS: parent and step tree remain unchanged after synthetic insert failure.'
  );
} finally {
  await pool.end();
}
