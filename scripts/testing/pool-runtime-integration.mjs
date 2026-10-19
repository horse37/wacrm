// Integration probe for the real getPostgresPool() connecting as wacrm_runtime.
// Run only inside the disposable validation container started by scripts/testing/validate-pool-and-runner.ps1.
// Requires DATABASE_URL pointing at the wacrm_runtime login of a disposable PostgreSQL.
import assert from 'node:assert/strict';
import { getPostgresPool } from '../../src/lib/db/postgres-pool.ts';

const pool = getPostgresPool();
try {
  const { rows } = await pool.query(
    "SELECT current_user AS current_user, current_setting('application_name') AS application_name, 1 AS ok"
  );
  assert.equal(rows.length, 1);
  assert.equal(rows[0].current_user, 'wacrm_runtime');
  assert.equal(rows[0].application_name, 'wacrm-web');
  assert.equal(rows[0].ok, 1);

  let createDenied = false;
  try {
    await pool.query('CREATE TABLE public.pool_runtime_probe (id integer)');
  } catch (error) {
    createDenied = error?.code === '42501';
    if (!createDenied) throw error;
  }
  assert.equal(createDenied, true, 'wacrm_runtime must not be able to CREATE TABLE in public');

  console.log(
    `pool runtime integration SUCCESS: user=${rows[0].current_user} application_name=${rows[0].application_name} select=ok create_table=denied(42501)`
  );
} finally {
  await pool.end();
}
