import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { AppError } from '../../src/lib/db/errors.ts';
import { queryDb, withTransaction } from '../../src/lib/db/postgres-client.ts';
import { getPostgresPool } from '../../src/lib/db/postgres-pool.ts';

function requireSuccess(result, label) {
  if (!result.ok) {
    throw new Error(`${label} failed with ${result.error.code}`);
  }
  return result.data;
}

const tableName = `wacrm_db_contract_${randomUUID().replaceAll('-', '')}`;
const pool = getPostgresPool();

try {
  const ping = requireSuccess(
    await queryDb('SELECT $1::text AS value', ['synthetic']),
    'parameterized query'
  );
  assert.deepEqual(ping.rows, [{ value: 'synthetic' }]);

  const committed = await withTransaction(async (transaction) => {
    await transaction.query(
      `CREATE TABLE public.${tableName} (id integer PRIMARY KEY, value text NOT NULL)`
    );
    const inserted = await transaction.query(
      `INSERT INTO public.${tableName} (id, value) VALUES ($1, $2) RETURNING id`,
      [1, 'committed']
    );
    assert.equal(inserted.rowCount, 1);
    return 'committed';
  });
  assert.deepEqual(committed, { ok: true, data: 'committed' });

  const rollback = await withTransaction(async (transaction) => {
    await transaction.query(
      `INSERT INTO public.${tableName} (id, value) VALUES ($1, $2)`,
      [2, 'rolled back']
    );
    throw new AppError('conflict');
  });
  assert.equal(rollback.ok, false);
  if (rollback.ok) throw new Error('Expected the transaction to roll back.');
  assert.equal(rollback.error.code, 'conflict');

  const swallowedQueryFailure = await withTransaction(async (transaction) => {
    try {
      await transaction.query(
        `INSERT INTO public.${tableName} (id, value) VALUES ($1, $2)`,
        [1, 'duplicate']
      );
    } catch {
      return 'callback swallowed query failure';
    }

    return 'duplicate insert unexpectedly succeeded';
  });
  assert.equal(swallowedQueryFailure.ok, false);
  if (swallowedQueryFailure.ok) {
    throw new Error('A caught query failure must still fail the transaction.');
  }
  assert.equal(swallowedQueryFailure.error.code, 'conflict');

  const persisted = requireSuccess(
    await queryDb(`SELECT id, value FROM public.${tableName} ORDER BY id`),
    'committed-row verification'
  );
  assert.deepEqual(persisted.rows, [{ id: 1, value: 'committed' }]);

  requireSuccess(
    await queryDb(`DROP TABLE public.${tableName}`),
    'synthetic table cleanup'
  );
  console.log(
    'PostgreSQL DB contract integration SUCCESS: parameterized query, commit, rollback, caught-query failure handling, and pooled connection cleanup.'
  );
} finally {
  await pool.end();
}
