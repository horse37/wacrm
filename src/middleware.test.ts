import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ createServerClient: vi.fn() }));

vi.mock('@supabase/ssr', () => ({
  createServerClient: mocks.createServerClient,
}));

import { middleware } from './middleware';

describe('PostgreSQL-backed API runtime gate', () => {
  beforeEach(() => {
    vi.unstubAllEnvs();
    vi.stubEnv('WACRM_POSTGRES_APP_API_ENABLED', '0');
    mocks.createServerClient.mockReset();
  });

  it('returns 503 before auth or repository access when readiness is not enabled', async () => {
    const response = await middleware(
      new NextRequest('http://localhost/api/flows')
    );

    expect(response?.status).toBe(503);
    expect(response?.headers.get('cache-control')).toBe('no-store');
    expect(mocks.createServerClient).not.toHaveBeenCalled();
  });

  it('allows the route through only when readiness is explicitly enabled', async () => {
    vi.stubEnv('WACRM_POSTGRES_APP_API_ENABLED', '1');
    mocks.createServerClient.mockReturnValue({
      auth: {
        getUser: vi.fn().mockResolvedValue({
          data: { user: { id: 'synthetic-user' } },
        }),
      },
    });

    const response = await middleware(
      new NextRequest('http://localhost/api/flows')
    );

    expect(response?.status).toBe(200);
    expect(mocks.createServerClient).toHaveBeenCalledTimes(1);
  });
});
