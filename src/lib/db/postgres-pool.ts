// Server-side by usage convention only: no package-level guard verifies this boundary.
// Import only from server code and never expose DATABASE_URL through NEXT_PUBLIC_*.

import { Pool } from 'pg';
import type { PoolConfig } from 'pg';

type GlobalWithPostgresPool = typeof globalThis & {
  __wacrmPostgresPool?: Pool;
};

const globalWithPostgresPool = globalThis as GlobalWithPostgresPool;

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
