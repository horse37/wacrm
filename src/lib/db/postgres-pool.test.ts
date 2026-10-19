import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const poolMocks = vi.hoisted(() => {
  const instances: Array<{
    config: Record<string, unknown>;
    listeners: Map<string, (error: Error) => void>;
    on: (event: string, listener: (error: Error) => void) => void;
  }> = [];

  class MockPool {
    config: Record<string, unknown>;
    listeners = new Map<string, (error: Error) => void>();

    constructor(config: Record<string, unknown>) {
      this.config = config;
      instances.push(this);
    }

    on(event: string, listener: (error: Error) => void) {
      this.listeners.set(event, listener);
      return this;
    }
  }

  return { instances, MockPool };
});

vi.mock('pg', () => ({ Pool: poolMocks.MockPool }));

const poolOnGlobal = globalThis as typeof globalThis & {
  __wacrmPostgresPool?: unknown;
};

async function loadPoolModule() {
  vi.resetModules();
  return import('./postgres-pool');
}

describe('getPostgresPool', () => {
  beforeEach(() => {
    vi.unstubAllEnvs();
    vi.stubEnv('PG_POOL_MAX', '');
    vi.stubEnv('PG_IDLE_TIMEOUT_MS', '');
    vi.stubEnv('PG_CONNECTION_TIMEOUT_MS', '');
    vi.stubEnv(
      'DATABASE_URL',
      'postgres://synthetic:synthetic@localhost:5432/wacrm'
    );
    delete poolOnGlobal.__wacrmPostgresPool;
    poolMocks.instances.length = 0;
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
    delete poolOnGlobal.__wacrmPostgresPool;
  });

  it('requires DATABASE_URL before constructing a pool', async () => {
    vi.stubEnv('DATABASE_URL', '');
    const { getPostgresPool } = await loadPoolModule();

    expect(() => getPostgresPool()).toThrow(
      'DATABASE_URL is required for PostgreSQL access'
    );
    expect(poolMocks.instances).toHaveLength(0);
  });

  it.each(
    ['PG_POOL_MAX', 'PG_IDLE_TIMEOUT_MS', 'PG_CONNECTION_TIMEOUT_MS'].flatMap(
      (name) => ['0', '1.5', 'invalid'].map((value) => ({ name, value }))
    )
  )('rejects invalid $name value $value', async ({ name, value }) => {
    vi.stubEnv(name, value);
    const { getPostgresPool } = await loadPoolModule();

    expect(() => getPostgresPool()).toThrow(
      `${name} must be a positive integer`
    );
    expect(poolMocks.instances).toHaveLength(0);
  });

  it('uses documented defaults when optional pool settings are unset', async () => {
    const { getPostgresPool } = await loadPoolModule();

    getPostgresPool();

    expect(poolMocks.instances[0]?.config).toMatchObject({
      max: 10,
      idleTimeoutMillis: 30_000,
      connectionTimeoutMillis: 10_000,
    });
  });

  it('uses validated settings and returns a process-wide singleton', async () => {
    vi.stubEnv('PG_POOL_MAX', '4');
    vi.stubEnv('PG_IDLE_TIMEOUT_MS', '12000');
    vi.stubEnv('PG_CONNECTION_TIMEOUT_MS', '2500');
    const { getPostgresPool } = await loadPoolModule();

    const first = getPostgresPool();
    const second = getPostgresPool();

    expect(second).toBe(first);
    expect(poolMocks.instances).toHaveLength(1);
    expect(poolMocks.instances[0]?.config).toEqual({
      connectionString: 'postgres://synthetic:synthetic@localhost:5432/wacrm',
      max: 4,
      idleTimeoutMillis: 12000,
      connectionTimeoutMillis: 2500,
      application_name: 'wacrm-web',
    });
  });

  it('logs only the PostgreSQL error code for idle-client errors', async () => {
    const { getPostgresPool } = await loadPoolModule();
    const consoleError = vi
      .spyOn(console, 'error')
      .mockImplementation(() => {});
    getPostgresPool();
    const error = Object.assign(new Error('sensitive connection detail'), {
      code: '57P01',
    });

    poolMocks.instances[0]?.listeners.get('error')?.(error);

    expect(consoleError).toHaveBeenCalledWith(
      'Unexpected error on an idle PostgreSQL client',
      { code: '57P01' }
    );
    expect(JSON.stringify(consoleError.mock.calls)).not.toContain(
      'sensitive connection detail'
    );
  });
});
