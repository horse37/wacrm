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

vi.mock('server-only', () => ({}));

vi.mock('pg', () => ({ Pool: poolMocks.MockPool }));

const poolOnGlobal = globalThis as typeof globalThis & {
  __wacrmPostgresPool?: unknown;
};

async function loadPoolModule() {
  vi.resetModules();
  return import('./postgres-pool');
}

type TestPgClient = {
  query: (text: string) => Promise<{ rows: Array<Record<string, unknown>> }>;
};

type TestConnectionHook = (client: TestPgClient) => Promise<void>;

function getConnectionHook(): TestConnectionHook {
  const hook = poolMocks.instances[0]?.config.onConnect;
  if (typeof hook !== 'function') {
    throw new Error('PostgreSQL role verification hook is missing');
  }
  return hook as unknown as TestConnectionHook;
}

const safeRuntimeRole = {
  current_is_superuser: false,
  session_is_superuser: false,
  current_bypasses_rls: false,
  session_bypasses_rls: false,
  current_is_role_admin: false,
  session_is_role_admin: false,
  member_of_privileged_role: false,
};

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
    expect(poolMocks.instances[0]?.config).toMatchObject({
      connectionString: 'postgres://synthetic:synthetic@localhost:5432/wacrm',
      max: 4,
      idleTimeoutMillis: 12000,
      connectionTimeoutMillis: 2500,
      application_name: 'wacrm-web',
    });
    expect(poolMocks.instances[0]?.config.onConnect).toBeTypeOf('function');
  });

  it('verifies the PostgreSQL role before a newly connected client is acquired', async () => {
    const { getPostgresPool } = await loadPoolModule();
    getPostgresPool();
    const onConnect = getConnectionHook();
    const query = vi.fn().mockResolvedValue({ rows: [safeRuntimeRole] });
    const client: TestPgClient = {
      query,
    };

    await expect(onConnect(client)).resolves.toBeUndefined();
    expect(client.query).toHaveBeenCalledTimes(1);
    expect(client.query).toHaveBeenCalledWith(
      expect.stringContaining('pg_catalog.pg_has_role')
    );
    const roleQuery = query.mock.calls[0]?.[0];
    expect(roleQuery).toContain("'postgres'");
    expect(roleQuery).toContain("owned_table.relkind IN ('r', 'p')");
    expect(roleQuery).toContain('owned_namespace.nspname');
  });

  it.each([
    { label: 'current superuser', field: 'current_is_superuser' },
    { label: 'session superuser', field: 'session_is_superuser' },
    { label: 'current BYPASSRLS', field: 'current_bypasses_rls' },
    { label: 'session BYPASSRLS', field: 'session_bypasses_rls' },
    { label: 'current role administrator', field: 'current_is_role_admin' },
    { label: 'session role administrator', field: 'session_is_role_admin' },
    {
      label: 'membership in privileged role',
      field: 'member_of_privileged_role',
    },
  ])('rejects $label before handing out a client', async ({ field }) => {
    const { getPostgresPool } = await loadPoolModule();
    getPostgresPool();
    const onConnect = getConnectionHook();
    const client: TestPgClient = {
      query: vi.fn().mockResolvedValue({
        rows: [{ ...safeRuntimeRole, [field]: true }],
      }),
    };

    await expect(onConnect(client)).rejects.toThrow(
      'PostgreSQL pool requires a least-privilege role that cannot bypass row-level security'
    );
    expect(client.query).toHaveBeenCalledTimes(1);
  });

  it('fails closed when PostgreSQL role privileges cannot be verified', async () => {
    const { getPostgresPool } = await loadPoolModule();
    getPostgresPool();
    const onConnect = getConnectionHook();
    const client: TestPgClient = {
      query: vi.fn().mockResolvedValue({ rows: [] }),
    };

    await expect(onConnect(client)).rejects.toThrow(
      'PostgreSQL pool requires a least-privilege role that cannot bypass row-level security'
    );
  });

  it('fails closed when PostgreSQL role privilege inspection errors', async () => {
    const { getPostgresPool } = await loadPoolModule();
    getPostgresPool();
    const onConnect = getConnectionHook();
    const client: TestPgClient = {
      query: vi.fn().mockRejectedValue(new Error('private catalog details')),
    };

    await expect(onConnect(client)).rejects.toThrow(
      'PostgreSQL pool requires a least-privilege role that cannot bypass row-level security'
    );
    await expect(onConnect(client)).rejects.not.toThrow(
      'private catalog details'
    );
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
