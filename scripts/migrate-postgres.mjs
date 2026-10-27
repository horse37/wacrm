import { createHash } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const DEFAULT_OWNER_ROLE = 'postgres';
const DEFAULT_MIGRATION_LOCK_TIMEOUT_MS = 120_000;
const DEFAULT_LOCK_POLL_INTERVAL_MS = 100;
const MIGRATION_LOCK_KEYS = [1463894866, 1];
const SCRIPT_DIRECTORY = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_MIGRATIONS_DIRECTORY = path.resolve(
  SCRIPT_DIRECTORY,
  '../supabase/migrations'
);

function quoteRole(role) {
  if (!/^[a-z_][a-z0-9_$]*$/i.test(role)) {
    throw new Error(`Invalid PostgreSQL owner role name: ${role}`);
  }

  return `"${role.replaceAll('"', '""')}"`;
}

function isAcceptedMigrationChecksum(storedChecksum, migration) {
  const checksum = storedChecksum.trim();
  return (
    checksum === migration.checksum ||
    migration.legacyChecksums?.includes(checksum) === true
  );
}
export async function discoverMigrations(
  directory = DEFAULT_MIGRATIONS_DIRECTORY
) {
  const entries = await readdir(directory, { withFileTypes: true });
  const sqlFiles = entries.filter(
    (entry) => entry.isFile() && entry.name.toLowerCase().endsWith('.sql')
  );
  const migrations = [];
  const versions = new Set();

  for (const entry of sqlFiles) {
    // Three to nine digits: versions below 1000 keep three-digit prefixes; the
    // nine-digit ceiling keeps Number() exact and within the integer column.
    const match = /^(\d{3,9})_[a-z0-9][a-z0-9_-]*\.sql$/i.exec(entry.name);
    if (!match) {
      throw new Error(`Invalid migration filename: ${entry.name}`);
    }

    const version = Number(match[1]);
    if (versions.has(version)) {
      throw new Error(`Duplicate migration version ${version}`);
    }
    versions.add(version);

    const contents = await readFile(path.join(directory, entry.name));
    const sql = contents.toString('utf8');
    const normalizedSql = sql.replace(/\r\n?/g, '\n');
    const checksum = createHash('sha256')
      .update(normalizedSql, 'utf8')
      .digest('hex');
    const legacyChecksums = [
      contents,
      Buffer.from(normalizedSql, 'utf8'),
      Buffer.from(normalizedSql.replace(/\n/g, '\r\n'), 'utf8'),
    ].map((bytes) => createHash('sha256').update(bytes).digest('hex'));

    migrations.push({
      version,
      name: entry.name,
      sql,
      checksum,
      legacyChecksums: [...new Set(legacyChecksums)],
    });
  }

  if (migrations.length === 0) {
    throw new Error(`No SQL migrations found in ${directory}`);
  }

  migrations.sort((left, right) => left.version - right.version);
  return migrations;
}

async function assertLeastPrivilegeIdentity(client, ownerRole) {
  const session = await client.query(
    `SELECT rolname, rolsuper, rolcanlogin, rolcreatedb, rolcreaterole,
            rolinherit, rolbypassrls
       FROM pg_roles
      WHERE rolname = session_user`
  );
  if (
    session.rows.length !== 1 ||
    session.rows[0].rolsuper ||
    !session.rows[0].rolcanlogin ||
    session.rows[0].rolcreatedb ||
    session.rows[0].rolcreaterole ||
    session.rows[0].rolinherit ||
    session.rows[0].rolbypassrls ||
    session.rows[0].rolname === ownerRole
  ) {
    throw new Error(
      'The migration login must be a distinct LOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS role'
    );
  }

  const memberships = await client.query(
    `SELECT granted.rolname AS granted_role, member.rolname AS member_role
     FROM pg_auth_members AS membership
     JOIN pg_roles AS granted ON granted.oid = membership.roleid
     JOIN pg_roles AS member ON member.oid = membership.member
     WHERE member.rolname IN (session_user, $1)`,
    [ownerRole]
  );
  if (
    memberships.rows.length !== 1 ||
    memberships.rows[0].member_role !== session.rows[0].rolname ||
    memberships.rows[0].granted_role !== ownerRole
  ) {
    throw new Error(
      'The migration login may only be a member of the migration owner, and the migration owner may not be a member of other roles'
    );
  }

  await client.query(`SET ROLE ${quoteRole(ownerRole)}`);
  try {
    const owner = await client.query(
      `SELECT rolname, rolsuper, rolcanlogin, rolcreatedb, rolcreaterole,
              rolinherit, rolbypassrls
         FROM pg_roles
        WHERE rolname = current_user`
    );
    if (
      owner.rows.length !== 1 ||
      owner.rows[0].rolname !== ownerRole ||
      owner.rows[0].rolsuper ||
      owner.rows[0].rolcanlogin ||
      owner.rows[0].rolcreatedb ||
      owner.rows[0].rolcreaterole ||
      owner.rows[0].rolinherit ||
      owner.rows[0].rolbypassrls
    ) {
      throw new Error(
        `Migration owner role ${ownerRole} must be NOLOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS`
      );
    }
  } catch (error) {
    await client.query('RESET ROLE').catch(() => undefined);
    throw error;
  }
}

export async function acquireMigrationLock(
  client,
  timeoutMs = DEFAULT_MIGRATION_LOCK_TIMEOUT_MS,
  pollIntervalMs = DEFAULT_LOCK_POLL_INTERVAL_MS
) {
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs <= 0) {
    throw new Error('Migration lock timeout must be a positive safe integer');
  }
  if (!Number.isSafeInteger(pollIntervalMs) || pollIntervalMs <= 0) {
    throw new Error(
      'Migration lock poll interval must be a positive safe integer'
    );
  }

  const deadline = Date.now() + timeoutMs;
  while (true) {
    const result = await client.query(
      'SELECT pg_try_advisory_lock($1, $2) AS acquired',
      MIGRATION_LOCK_KEYS
    );
    if (result.rows[0]?.acquired === true) return;

    const remainingMs = deadline - Date.now();
    if (remainingMs <= 0) {
      throw new Error(
        `Timed out waiting ${timeoutMs}ms for the migration advisory lock`
      );
    }
    await new Promise((resolve) =>
      setTimeout(resolve, Math.min(pollIntervalMs, remainingMs))
    );
  }
}
export async function runMigrations({
  pool,
  directory = DEFAULT_MIGRATIONS_DIRECTORY,
  ownerRole = DEFAULT_OWNER_ROLE,
  lockTimeoutMs = DEFAULT_MIGRATION_LOCK_TIMEOUT_MS,
  lockPollIntervalMs = DEFAULT_LOCK_POLL_INTERVAL_MS,
  logger = console,
}) {
  if (ownerRole !== DEFAULT_OWNER_ROLE) {
    throw new Error(
      `The migration chain requires owner role "${DEFAULT_OWNER_ROLE}"`
    );
  }

  const migrations = await discoverMigrations(directory);
  const client = await pool.connect();
  let lockAcquired = false;
  let roleSet = false;
  let releaseError;
  let applied = 0;
  let skipped = 0;

  try {
    await assertLeastPrivilegeIdentity(client, ownerRole);
    roleSet = true;
    await acquireMigrationLock(client, lockTimeoutMs, lockPollIntervalMs);
    lockAcquired = true;

    await client.query(`
      CREATE TABLE IF NOT EXISTS public.wacrm_schema_migrations (
        version integer PRIMARY KEY,
        name text NOT NULL,
        checksum char(64) NOT NULL,
        applied_at timestamptz NOT NULL DEFAULT clock_timestamp()
      )
    `);

    const existingResult = await client.query(
      'SELECT version, name, checksum FROM public.wacrm_schema_migrations'
    );
    const existing = new Map(
      existingResult.rows.map((row) => [row.version, row])
    );
    const migrationVersions = new Set(migrations.map(({ version }) => version));

    for (const version of existing.keys()) {
      if (!migrationVersions.has(version)) {
        throw new Error(`Migration ledger contains unknown version ${version}`);
      }
    }

    let encounteredGap = false;
    for (const migration of migrations) {
      if (!existing.has(migration.version)) {
        encounteredGap = true;
      } else if (encounteredGap) {
        throw new Error(
          `Migration ledger has a gap before version ${migration.version}`
        );
      }
    }

    for (const migration of migrations) {
      const previous = existing.get(migration.version);
      if (previous) {
        if (
          previous.name !== migration.name ||
          !isAcceptedMigrationChecksum(previous.checksum, migration)
        ) {
          throw new Error(
            `Applied migration ${migration.version} changed; add a new forward migration instead`
          );
        }
        skipped += 1;
        continue;
      }

      await client.query('BEGIN');
      try {
        await client.query(migration.sql);
        await client.query(
          `INSERT INTO public.wacrm_schema_migrations (version, name, checksum)
           VALUES ($1, $2, $3)`,
          [migration.version, migration.name, migration.checksum]
        );
        await client.query('COMMIT');
        applied += 1;
        logger.info?.(`[postgres-migrations] applied ${migration.name}`);
      } catch (error) {
        await client.query('ROLLBACK').catch(() => undefined);
        throw new Error(
          `Migration ${migration.name} failed: ${error.message}`,
          { cause: error }
        );
      }
    }

    return { applied, skipped, total: migrations.length };
  } catch (error) {
    releaseError = error;
    throw error;
  } finally {
    let cleanupError;
    if (lockAcquired) {
      try {
        await client.query(
          'SELECT pg_advisory_unlock($1, $2)',
          MIGRATION_LOCK_KEYS
        );
      } catch (error) {
        cleanupError ??= error;
      }
    }
    if (roleSet) {
      try {
        await client.query('RESET ROLE');
      } catch (error) {
        cleanupError ??= error;
      }
    }
    client.release(releaseError ?? cleanupError);
    if (!releaseError && cleanupError) {
      throw cleanupError;
    }
  }
}

async function main() {
  const connectionString = process.env.DATABASE_URL_MIGRATIONS;
  if (!connectionString) {
    throw new Error(
      'DATABASE_URL_MIGRATIONS is required to run PostgreSQL migrations'
    );
  }

  const ownerRole = process.env.WACRM_MIGRATION_OWNER_ROLE?.trim();
  if (!ownerRole) {
    throw new Error(
      'WACRM_MIGRATION_OWNER_ROLE must name a NOLOGIN NOSUPERUSER migration owner role'
    );
  }
  const lockTimeoutMs = Number(
    process.env.WACRM_MIGRATION_LOCK_TIMEOUT_MS ??
      DEFAULT_MIGRATION_LOCK_TIMEOUT_MS
  );
  const { Pool } = await import('pg');
  const pool = new Pool({
    connectionString,
    max: 1,
    connectionTimeoutMillis: 10_000,
    idleTimeoutMillis: 5_000,
    application_name: 'wacrm-migration-runner',
  });

  try {
    const result = await runMigrations({ pool, ownerRole, lockTimeoutMs });
    loggerOutput(result);
  } finally {
    await pool.end();
  }
}

function loggerOutput(result) {
  console.info(
    `[postgres-migrations] complete: applied=${result.applied}, skipped=${result.skipped}, total=${result.total}`
  );
}

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  main().catch((error) => {
    console.error(`[postgres-migrations] ${error.message}`);
    process.exitCode = 1;
  });
}
