import 'server-only';
// Server-side by usage convention; the internal query client adds Next.js's server-only guard.
// Import only from server code and never expose DATABASE_URL through NEXT_PUBLIC_*.

import { Pool } from 'pg';
import type { PoolConfig } from 'pg';

type GlobalWithPostgresPool = typeof globalThis & {
  __wacrmPostgresPool?: Pool;
};

const globalWithPostgresPool = globalThis as GlobalWithPostgresPool;
const runtimeRoleError =
  'PostgreSQL pool requires a least-privilege role that cannot bypass row-level security';

type RuntimeRolePrivileges = {
  current_is_superuser: boolean;
  session_is_superuser: boolean;
  current_bypasses_rls: boolean;
  session_bypasses_rls: boolean;
  current_is_role_admin: boolean;
  session_is_role_admin: boolean;
  member_of_privileged_role: boolean;
};

const runtimeRolePrivilegesQuery = `
  SELECT
    effective_role.rolsuper AS current_is_superuser,
    session_role.rolsuper AS session_is_superuser,
    effective_role.rolbypassrls AS current_bypasses_rls,
    session_role.rolbypassrls AS session_bypasses_rls,
    (effective_role.rolcreatedb OR effective_role.rolcreaterole) AS current_is_role_admin,
    (session_role.rolcreatedb OR session_role.rolcreaterole) AS session_is_role_admin,
    EXISTS (
      SELECT 1
      FROM pg_catalog.pg_roles AS granted_role
      WHERE (
        granted_role.rolsuper OR
        granted_role.rolbypassrls OR
        granted_role.rolcreatedb OR
        granted_role.rolcreaterole OR
        granted_role.rolname IN (
          'wacrm_owner',
          'wacrm_migrator',
          'wacrm_job',
          'postgres',
          'service_role',
          'supabase_admin'
        )
        OR granted_role.oid IN (
          SELECT owned_table.relowner
          FROM pg_catalog.pg_class AS owned_table
          JOIN pg_catalog.pg_namespace AS owned_namespace
            ON owned_namespace.oid = owned_table.relnamespace
          WHERE owned_table.relkind IN ('r', 'p')
            AND owned_namespace.nspname <> 'information_schema'
            AND pg_catalog.left(owned_namespace.nspname, 3) <> 'pg_'
        )
      )
      AND (
        pg_catalog.pg_has_role(effective_role.oid, granted_role.oid, 'MEMBER') OR
        pg_catalog.pg_has_role(session_role.oid, granted_role.oid, 'MEMBER')
      )
    ) AS member_of_privileged_role
  FROM pg_catalog.pg_roles AS effective_role
  JOIN pg_catalog.pg_roles AS session_role
    ON session_role.rolname = session_user
  WHERE effective_role.rolname = current_user
`;

async function assertLeastPrivilegeRuntimeRole(
  client: Parameters<NonNullable<PoolConfig['onConnect']>>[0]
): Promise<void> {
  let rows: RuntimeRolePrivileges[];
  try {
    rows = (
      await client.query<RuntimeRolePrivileges>(runtimeRolePrivilegesQuery)
    ).rows;
  } catch {
    throw new Error(runtimeRoleError);
  }

  const [role] = rows;
  if (
    rows.length !== 1 ||
    !role ||
    role.current_is_superuser ||
    role.session_is_superuser ||
    role.current_bypasses_rls ||
    role.session_bypasses_rls ||
    role.current_is_role_admin ||
    role.session_is_role_admin ||
    role.member_of_privileged_role
  ) {
    throw new Error(runtimeRoleError);
  }
}

function positiveIntegerFromEnv(name: string, fallback: number): number {
  const rawValue = process.env[name];
  if (rawValue === undefined || rawValue === '') return fallback;

  const value = Number(rawValue);
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`${name} must be a positive integer`);
  }
  return value;
}

function createPool(): Pool {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error('DATABASE_URL is required for PostgreSQL access');
  }

  const config: PoolConfig = {
    connectionString,
    max: positiveIntegerFromEnv('PG_POOL_MAX', 10),
    idleTimeoutMillis: positiveIntegerFromEnv('PG_IDLE_TIMEOUT_MS', 30_000),
    connectionTimeoutMillis: positiveIntegerFromEnv(
      'PG_CONNECTION_TIMEOUT_MS',
      10_000
    ),
    application_name: 'wacrm-web',
    // onConnect validates each new physical connection once; it is not an
    // atomic guard around later business queries. Role/policy changes may
    // affect existing sessions independently. Drain/restart this pool to
    // rerun the guard on replacement connections; RLS remains the per-query
    // application isolation boundary.
    onConnect: assertLeastPrivilegeRuntimeRole,
  };

  const pool = new Pool(config);
  pool.on('error', (error) => {
    const errorCode =
      'code' in error && typeof error.code === 'string'
        ? error.code
        : 'UNKNOWN';
    console.error('Unexpected error on an idle PostgreSQL client', {
      code: errorCode,
    });
  });
  return pool;
}

export function getPostgresPool(): Pool {
  globalWithPostgresPool.__wacrmPostgresPool ??= createPool();
  return globalWithPostgresPool.__wacrmPostgresPool;
}
