// Runner behavior probe on a disposable PostgreSQL with an isolated synthetic fixture.
// It proves runMigrations() behavior (apply, replay, ledger-gap refusal, rollback, correction,
// checksum refusal) for this fixture only. It does NOT prove the application's committed chain.
// Run only inside the disposable validation container (scripts/testing/validate-pool-and-runner.ps1).
import assert from 'node:assert/strict';
import { mkdtemp, rm, unlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import pg from 'pg';
import { runMigrations } from '../migrate-postgres.mjs';

const connectionString = process.env.DATABASE_URL_MIGRATIONS;
if (!connectionString) throw new Error('DATABASE_URL_MIGRATIONS is required');
// Verification uses the test-only bootstrap superuser: wacrm_migrator has no SELECT on the ledger by design.
const verifyConnectionString = process.env.DATABASE_URL_ADMIN_VERIFY;
if (!verifyConnectionString) throw new Error('DATABASE_URL_ADMIN_VERIFY is required');

const directory = await mkdtemp(path.join(os.tmpdir(), 'wacrm-runner-fixture-'));
const quietLogger = { info() {}, warn() {}, error() {}, log() {} };
const pool = new pg.Pool({
  connectionString,
  max: 1,
  application_name: 'wacrm-migration-runner-fixture',
});
const verifyPool = new pg.Pool({
  connectionString: verifyConnectionString,
  max: 1,
  application_name: 'wacrm-migration-runner-fixture-verify',
});
const run = () =>
  runMigrations({
    pool,
    directory,
    ownerRole: 'postgres',
    logger: quietLogger,
    lockTimeoutMs: 10_000,
    lockPollIntervalMs: 50,
  });
const query = (sql) => verifyPool.query(sql);
const counts = (r) => [r.applied, r.skipped, r.total];
const ledgerCount = async () =>
  (await query('SELECT count(*)::int AS n FROM public.wacrm_schema_migrations')).rows[0].n;

try {
  await writeFile(path.join(directory, '001_fixture_a.sql'), 'CREATE TABLE public.fixture_a (id integer PRIMARY KEY);\n');
  await writeFile(path.join(directory, '002_fixture_b.sql'), 'CREATE TABLE public.fixture_b (id integer PRIMARY KEY);\n');
  await writeFile(path.join(directory, '1000_fixture_future.sql'), 'CREATE TABLE public.fixture_future (id integer PRIMARY KEY);\n');

  assert.deepEqual(counts(await run()), [3, 0, 3], 'first run applies all three fixture migrations');
  assert.deepEqual(counts(await run()), [0, 3, 3], 'replay skips every applied fixture migration');

  // A lower-numbered migration added after 1000 is applied must be refused (ordered, fail-closed).
  await writeFile(path.join(directory, '003_fixture_gap.sql'), 'CREATE TABLE public.fixture_gap (id integer PRIMARY KEY);\n');
  await assert.rejects(run(), /Migration ledger has a gap before version 1000/, 'out-of-order migration is refused');
  const gapRelation = await query("SELECT to_regclass('public.fixture_gap') AS relation");
  assert.equal(gapRelation.rows[0].relation, null, 'refused migration executed no DDL');
  assert.equal(await ledgerCount(), 3, 'ledger unchanged after refusal');
  await unlink(path.join(directory, '003_fixture_gap.sql'));

  // A migration above the last applied version that creates a table and then fails must roll back.
  await writeFile(
    path.join(directory, '1001_fixture_fail.sql'),
    'CREATE TABLE public.fixture_partial (id integer PRIMARY KEY);\nSELECT 1/0;\n'
  );
  await assert.rejects(run(), /division by zero/, 'failing migration aborts the run');
  const partial = await query("SELECT to_regclass('public.fixture_partial') AS relation");
  assert.equal(partial.rows[0].relation, null, 'DDL of the failed migration is rolled back');
  assert.equal(await ledgerCount(), 3, 'ledger keeps only the three successful migrations');

  // Correcting the failed migration applies it exactly once.
  await writeFile(path.join(directory, '1001_fixture_fail.sql'), 'CREATE TABLE public.fixture_partial (id integer PRIMARY KEY);\n');
  assert.deepEqual(counts(await run()), [1, 3, 4], 'corrected migration applies once');
  assert.deepEqual(counts(await run()), [0, 4, 4], 'replay after correction skips all four');

  // An already-applied migration whose content changed must be refused before execution.
  await writeFile(
    path.join(directory, '001_fixture_a.sql'),
    'CREATE TABLE public.fixture_a (id integer PRIMARY KEY, changed integer);\n'
  );
  await assert.rejects(run(), /Applied migration 1 changed/, 'changed applied checksum is refused');

  const relations = await query(
    "SELECT to_regclass('public.fixture_a') AS a, to_regclass('public.fixture_future') AS future, to_regclass('public.fixture_partial') AS partial"
  );
  assert.notEqual(relations.rows[0].a, null);
  assert.notEqual(relations.rows[0].future, null);
  assert.notEqual(relations.rows[0].partial, null);

  console.log(
    'runner fixture integration SUCCESS: apply=3, replay=skipped 3, gap refused, failure rolled back, corrected applied once, replay skipped 4, changed checksum refused'
  );
} finally {
  await rm(directory, { recursive: true, force: true });
  await pool.end();
  await verifyPool.end();
}
