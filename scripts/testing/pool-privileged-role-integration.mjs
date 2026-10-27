// Integration probe for rejecting a runtime identity that can bypass RLS.
// Run only inside the disposable validation container from validate-pool-and-runner.ps1.
import assert from 'node:assert/strict';
import { getPostgresPool } from '../../src/lib/db/postgres-pool.ts';

const pool = getPostgresPool();
try {
  await assert.rejects(
    pool.query('SELECT 1'),
    (error) =>
      error instanceof Error &&
      error.message ===
        'PostgreSQL pool requires a least-privilege role that cannot bypass row-level security'
  );
  console.log(
    'pool least-privilege integration SUCCESS: unsafe identity rejected before query'
  );
} finally {
  await pool.end();
}
