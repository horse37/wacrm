import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  acquireMigrationLock,
  discoverMigrations,
  runMigrations,
} from './migrate-postgres.mjs';

async function createTempDirectory() {
  return mkdtemp(path.join(os.tmpdir(), 'wacrm-migrations-'));
}

function createMockPool({
  ledger = [],
  failMigration = false,
  loginIsSuperuser = false,
  loginCanCreateDb = false,
  loginCanCreateRole = false,
  loginInherits = false,
  loginBypassesRls = false,
  additionalRoleMemberships = [],
  ownerIsSuperuser = false,
  ownerCanLogin = false,
  ownerCanCreateDb = false,
  ownerCanCreateRole = false,
  ownerInherits = false,
  ownerBypassesRls = false,
} = {}) {
  const calls = [];
  const migrationSql = [];
  const migrationRoles = [];
  let currentRole = 'wacrm_migrator';
  let releasedWith;

  const client = {
    async query(query, values = []) {
      const sql = String(query).trim();
      calls.push(sql);

      if (sql === 'SET ROLE "postgres"') currentRole = 'postgres';
      if (sql === 'RESET ROLE') currentRole = 'wacrm_migrator';
      if (sql.includes('rolname = session_user')) {
        return {
          rows: [
            {
              rolname: 'wacrm_migrator',
              rolsuper: loginIsSuperuser,
              rolcanlogin: true,
              rolcreatedb: loginCanCreateDb,
              rolcreaterole: loginCanCreateRole,
              rolinherit: loginInherits,
              rolbypassrls: loginBypassesRls,
            },
          ],
        };
      }
      if (sql.includes('rolname = current_user')) {
        return {
          rows: [
            {
              rolname: currentRole,
              rolsuper: ownerIsSuperuser,
              rolcanlogin: ownerCanLogin,
              rolcreatedb: ownerCanCreateDb,
              rolcreaterole: ownerCanCreateRole,
              rolinherit: ownerInherits,
              rolbypassrls: ownerBypassesRls,
            },
          ],
        };
      }
      if (sql.includes('FROM pg_auth_members')) {
        return {
          rows: [
            {
              member_role: 'wacrm_migrator',
              granted_role: 'postgres',
            },
            ...additionalRoleMemberships,
          ],
        };
      }
      if (sql.startsWith('SELECT pg_try_advisory_lock')) {
        return { rows: [{ acquired: true }] };
      }
      if (sql.startsWith('SELECT version, name, checksum')) {
        return { rows: [...ledger] };
      }
      if (sql.startsWith('INSERT INTO public.wacrm_schema_migrations')) {
        ledger.push({
          version: values[0],
          name: values[1],
          checksum: values[2],
        });
        return { rows: [] };
      }
      if (sql.startsWith("SELECT 'migration")) {
        migrationSql.push(sql);
        migrationRoles.push(currentRole);
        if (failMigration) throw new Error('synthetic migration failure');
      }
      return { rows: [] };
    },
    release(error) {
      releasedWith = error;
    },
  };

  return {
    calls,
    client,
    ledger,
    migrationSql,
    migrationRoles,
    get releasedWith() {
      return releasedWith;
    },
    async connect() {
      return client;
    },
  };
}

test('discovers SQL migrations in numeric order and hashes their exact contents', async () => {
  const directory = await createTempDirectory();

  try {
    await writeFile(path.join(directory, '010_tenth.sql'), 'SELECT 10;\n');
    await writeFile(path.join(directory, '002_second.sql'), 'SELECT 2;\n');
    await writeFile(path.join(directory, '001_first.sql'), 'SELECT 1;\n');
    await writeFile(path.join(directory, 'README.md'), 'ignored');

    const migrations = await discoverMigrations(directory);

    assert.deepEqual(
      migrations.map(({ version }) => version),
      [1, 2, 10]
    );
    assert.equal(migrations[0].name, '001_first.sql');
    assert.equal(migrations[0].checksum.length, 64);
    assert.equal(migrations[0].sql, 'SELECT 1;\n');
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('rejects SQL files without a numeric migration prefix of three to nine digits', async () => {
  for (const name of [
    'initial.sql',
    '1_short.sql',
    '01_short.sql',
    '0001name.sql',
    '1000000000_too_long.sql',
  ]) {
    const directory = await createTempDirectory();

    try {
      await writeFile(path.join(directory, name), 'SELECT 1;');

      await assert.rejects(
        discoverMigrations(directory),
        new RegExp(`Invalid migration filename: ${name.replace(/\./g, '\\.')}`)
      );
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  }
});

test('accepts current three-digit and future four-digit migration prefixes in numeric order', async () => {
  const directory = await createTempDirectory();

  try {
    await writeFile(path.join(directory, '1000_future.sql'), 'SELECT 1000;');
    await writeFile(path.join(directory, '027_current.sql'), 'SELECT 27;');
    await writeFile(path.join(directory, '999_last_three.sql'), 'SELECT 999;');

    const migrations = await discoverMigrations(directory);

    assert.deepEqual(
      migrations.map(({ version }) => version),
      [27, 999, 1000]
    );
    assert.equal(migrations[2].name, '1000_future.sql');
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('rejects a four-digit prefix that duplicates a three-digit version', async () => {
  const directory = await createTempDirectory();

  try {
    await writeFile(path.join(directory, '001_first.sql'), 'SELECT 1;');
    await writeFile(path.join(directory, '0001_duplicate.sql'), 'SELECT 2;');

    await assert.rejects(
      discoverMigrations(directory),
      /Duplicate migration version 1/
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('rejects duplicate migration versions rather than applying ambiguous order', async () => {
  const directory = await createTempDirectory();

  try {
    await writeFile(path.join(directory, '001_first.sql'), 'SELECT 1;');
    await writeFile(path.join(directory, '001_duplicate.sql'), 'SELECT 2;');

    await assert.rejects(
      discoverMigrations(directory),
      /Duplicate migration version 1/
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('applies migrations in order under the advisory lock and records checksums', async () => {
  const directory = await createTempDirectory();
  const pool = createMockPool();

  try {
    await writeFile(
      path.join(directory, '002_second.sql'),
      "SELECT 'migration-2';\n"
    );
    await writeFile(
      path.join(directory, '001_first.sql'),
      "SELECT 'migration-1';\n"
    );

    const result = await runMigrations({
      pool,
      directory,
      logger: { info() {} },
    });

    assert.deepEqual(result, { applied: 2, skipped: 0, total: 2 });
    assert.deepEqual(pool.migrationSql, [
      "SELECT 'migration-1';",
      "SELECT 'migration-2';",
    ]);
    assert.deepEqual(pool.migrationRoles, ['postgres', 'postgres']);
    assert.ok(
      pool.calls.indexOf('SET ROLE "postgres"') <
        pool.calls.indexOf("SELECT 'migration-1';")
    );
    assert.deepEqual(
      pool.ledger.map(({ version }) => version),
      [1, 2]
    );
    const lockCallIndex = pool.calls.indexOf(
      'SELECT pg_try_advisory_lock($1, $2) AS acquired'
    );
    const beginIndex = pool.calls.indexOf('BEGIN');
    assert.ok(lockCallIndex >= 0);
    assert.ok(beginIndex >= 0);
    assert.ok(lockCallIndex < beginIndex);
    assert.ok(pool.calls.includes('SELECT pg_advisory_unlock($1, $2)'));
    assert.ok(pool.calls.includes('RESET ROLE'));
    assert.equal(pool.releasedWith, undefined);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('replay skips already applied migrations without executing their SQL again', async () => {
  const directory = await createTempDirectory();
  const pool = createMockPool();

  try {
    await writeFile(
      path.join(directory, '001_first.sql'),
      "SELECT 'migration-1';\n"
    );

    const first = await runMigrations({
      pool,
      directory,
      logger: { info() {} },
    });
    const second = await runMigrations({
      pool,
      directory,
      logger: { info() {} },
    });

    assert.deepEqual(first, { applied: 1, skipped: 0, total: 1 });
    assert.deepEqual(second, { applied: 0, skipped: 1, total: 1 });
    assert.equal(pool.migrationSql.length, 1);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('rejects a changed checksum before executing an applied migration', async () => {
  const directory = await createTempDirectory();
  const pool = createMockPool({
    ledger: [{ version: 1, name: '001_first.sql', checksum: '0'.repeat(64) }],
  });

  try {
    await writeFile(
      path.join(directory, '001_first.sql'),
      "SELECT 'migration-1';\n"
    );

    await assert.rejects(
      runMigrations({ pool, directory, logger: { info() {} } }),
      /Applied migration 1 changed/
    );
    assert.equal(pool.migrationSql.length, 0);
    assert.ok(pool.calls.includes('SELECT pg_advisory_unlock($1, $2)'));
    assert.ok(pool.calls.includes('RESET ROLE'));
    assert.ok(pool.releasedWith instanceof Error);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('rolls back a failed migration and releases the role and advisory lock', async () => {
  const directory = await createTempDirectory();
  const pool = createMockPool({ failMigration: true });

  try {
    await writeFile(
      path.join(directory, '001_first.sql'),
      "SELECT 'migration-1';\n"
    );

    await assert.rejects(
      runMigrations({ pool, directory, logger: { info() {} } }),
      /Migration 001_first\.sql failed: synthetic migration failure/
    );
    assert.ok(pool.calls.includes('ROLLBACK'));
    assert.ok(pool.calls.includes('SELECT pg_advisory_unlock($1, $2)'));
    assert.ok(pool.calls.includes('RESET ROLE'));
    assert.equal(pool.ledger.length, 0);
    assert.ok(pool.releasedWith instanceof Error);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('rejects a superuser migration login before acquiring the advisory lock', async () => {
  const directory = await createTempDirectory();
  const pool = createMockPool({ loginIsSuperuser: true });

  try {
    await writeFile(
      path.join(directory, '001_first.sql'),
      "SELECT 'migration-1';\n"
    );

    await assert.rejects(
      runMigrations({ pool, directory, logger: { info() {} } }),
      /migration login must be a distinct LOGIN NOINHERIT NOSUPERUSER/
    );
assert.equal(
pool.calls.some((sql) => sql.includes('pg_try_advisory_lock')),
false
);
    assert.equal(pool.migrationSql.length, 0);
    assert.ok(pool.releasedWith instanceof Error);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('rejects migration login membership in roles beyond the migration owner', async () => {
  const directory = await createTempDirectory();
  const pool = createMockPool({
    additionalRoleMemberships: [
      { member_role: 'wacrm_migrator', granted_role: 'service_role' },
    ],
  });
  try {
    await writeFile(path.join(directory, '001_first.sql'), 'SELECT 1;\n');
    await assert.rejects(
      runMigrations({ pool, directory }),
      /may only be a member of the migration owner/
    );
    assert.equal(
      pool.calls.some((sql) => sql.includes('pg_try_advisory_lock')),
      false
    );
    assert.equal(pool.migrationSql.length, 0);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('rejects migration owner membership in additional roles', async () => {
  const directory = await createTempDirectory();
  const pool = createMockPool({
    additionalRoleMemberships: [
      { member_role: 'postgres', granted_role: 'service_role' },
    ],
  });
  try {
    await writeFile(path.join(directory, '001_first.sql'), 'SELECT 1;\n');
    await assert.rejects(
      runMigrations({ pool, directory }),
      /may only be a member of the migration owner/
    );
    assert.equal(
      pool.calls.some((sql) => sql.includes('pg_try_advisory_lock')),
      false
    );
    assert.equal(pool.migrationSql.length, 0);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('rejects a superuser migration owner before taking the advisory lock', async () => {
  const directory = await createTempDirectory();
  const pool = createMockPool({ ownerIsSuperuser: true });
  try {
    await writeFile(path.join(directory, '001_first.sql'), 'SELECT 1;\n');
    await assert.rejects(
      runMigrations({ pool, directory }),
      /Migration owner role postgres must be NOLOGIN NOINHERIT NOSUPERUSER/
    );
    assert.equal(
      pool.calls.some((sql) => sql.includes('pg_try_advisory_lock')),
      false
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('rejects a login-capable migration owner before taking the advisory lock', async () => {
  const directory = await createTempDirectory();
  const pool = createMockPool({ ownerCanLogin: true });
  try {
    await writeFile(path.join(directory, '001_first.sql'), 'SELECT 1;\n');
    await assert.rejects(
      runMigrations({ pool, directory }),
      /Migration owner role postgres must be NOLOGIN NOINHERIT NOSUPERUSER/
    );
    assert.equal(
      pool.calls.some((sql) => sql.includes('pg_try_advisory_lock')),
      false
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('rejects migration login or owner roles with elevated PostgreSQL attributes', async () => {
  const cases = [
    { loginCanCreateDb: true },
    { loginCanCreateRole: true },
    { loginInherits: true },
    { loginBypassesRls: true },
    { ownerCanCreateDb: true },
    { ownerCanCreateRole: true },
    { ownerInherits: true },
    { ownerBypassesRls: true },
  ];

  for (const roleAttributes of cases) {
    const directory = await createTempDirectory();
    const pool = createMockPool(roleAttributes);
    try {
      await writeFile(path.join(directory, '001_first.sql'), 'SELECT 1;\n');
      await assert.rejects(
        runMigrations({ pool, directory }),
        /migration login must be a distinct LOGIN NOINHERIT|Migration owner role postgres must be NOLOGIN NOINHERIT/
      );
      assert.equal(
        pool.calls.some((sql) => sql.includes('pg_try_advisory_lock')),
        false
      );
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  }
});

test('normalizes CRLF checksums and accepts a legacy raw CRLF checksum', async () => {
  const lfDirectory = await createTempDirectory();
  const crlfDirectory = await createTempDirectory();
  const migrationName = '001_line_endings.sql';
  const lfSql = 'SELECT 1;\n';
  const crlfSql = 'SELECT 1;\r\n';
  try {
    await writeFile(path.join(lfDirectory, migrationName), lfSql);
    await writeFile(path.join(crlfDirectory, migrationName), crlfSql);
    const [lfMigration] = await discoverMigrations(lfDirectory);
    const [crlfMigration] = await discoverMigrations(crlfDirectory);
    assert.equal(lfMigration.checksum, crlfMigration.checksum);

    const legacyChecksum = createHash('sha256')
      .update(Buffer.from(crlfSql))
      .digest('hex');
    const pool = createMockPool({
      ledger: [{ version: 1, name: migrationName, checksum: legacyChecksum }],
    });
    const result = await runMigrations({ pool, directory: crlfDirectory });
    assert.equal(result.skipped, 1);
    assert.equal(pool.migrationSql.length, 0);
  } finally {
    await rm(lfDirectory, { recursive: true, force: true });
    await rm(crlfDirectory, { recursive: true, force: true });
  }
});

test('rejects an unknown migration version already present in the ledger', async () => {
  const directory = await createTempDirectory();
  const pool = createMockPool({
    ledger: [
      { version: 999, name: '999_unknown.sql', checksum: '0'.repeat(64) },
    ],
  });
  try {
    await writeFile(path.join(directory, '001_first.sql'), 'SELECT 1;\n');
    await assert.rejects(
      runMigrations({ pool, directory }),
      /Migration ledger contains unknown version 999/
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('rejects a ledger gap instead of applying later migrations out of order', async () => {
  const directory = await createTempDirectory();
  const first = '001_first.sql';
  const second = '002_second.sql';
  await writeFile(path.join(directory, first), 'SELECT 1;\n');
  await writeFile(path.join(directory, second), 'SELECT 2;\n');
  const pool = createMockPool({
    ledger: [{ version: 2, name: second, checksum: '0'.repeat(64) }],
  });
  try {
    await assert.rejects(runMigrations({ pool, directory }), /gap/i);
    assert.equal(pool.migrationSql.length, 0);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('rejects a migration name mismatch for a version already in the ledger', async () => {
  const directory = await createTempDirectory();
  const migrationName = '001_current.sql';
  await writeFile(path.join(directory, migrationName), 'SELECT 1;\n');
  const pool = createMockPool({
    ledger: [{ version: 1, name: '001_old.sql', checksum: '0'.repeat(64) }],
  });
  try {
    await assert.rejects(runMigrations({ pool, directory }), /changed/);
    assert.equal(pool.migrationSql.length, 0);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('bounds advisory-lock waits and propagates unlock failures', async () => {
  let attempts = 0;
  await assert.rejects(
    acquireMigrationLock(
      {
        async query() {
          attempts += 1;
          return { rows: [{ acquired: false }] };
        },
      },
      10,
      1
    ),
    /Timed out waiting 10ms/
  );
  assert.ok(attempts > 0);

  const directory = await createTempDirectory();
  const pool = createMockPool();
  await writeFile(path.join(directory, '001_first.sql'), 'SELECT 1;\n');
  const query = pool.client.query.bind(pool.client);
  pool.client.query = async (sql, values) => {
    if (String(sql).includes('pg_advisory_unlock')) {
      throw new Error('synthetic unlock failure');
    }
    return query(sql, values);
  };
  try {
    await assert.rejects(
      runMigrations({ pool, directory }),
      /synthetic unlock failure/
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
