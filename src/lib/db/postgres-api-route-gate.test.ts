import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { shouldBlockPostgresBackedApi } from './postgres-api-route-gate';

function listFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const fullPath = path.join(directory, entry.name);
    return entry.isDirectory() ? listFiles(fullPath) : [fullPath];
  });
}

const apiRoot = path.resolve(process.cwd(), 'src/app/api');

describe('PostgreSQL-backed API route gate', () => {
  it('blocks migrated route families unless the explicit readiness flag is on', () => {
    expect(shouldBlockPostgresBackedApi('/api/flows')).toBe(true);
    expect(shouldBlockPostgresBackedApi('/api/flows/abc/runs')).toBe(true);
    expect(shouldBlockPostgresBackedApi('/api/account/invitations')).toBe(true);
    expect(shouldBlockPostgresBackedApi('/api/whatsapp/send')).toBe(true);
    expect(shouldBlockPostgresBackedApi('/api/health')).toBe(false);
    expect(shouldBlockPostgresBackedApi('/api/accounting')).toBe(false);
  });

  it('blocks the event stream route with an indirect PostgreSQL dependency', () => {
    expect(shouldBlockPostgresBackedApi('/api/zap-lead/events/stream')).toBe(
      true
    );
  });

  it('requires the exact readiness value 1 to allow PostgreSQL-backed routes', () => {
    expect(
      shouldBlockPostgresBackedApi('/api/flows', {
        WACRM_POSTGRES_APP_API_ENABLED: 'true',
      })
    ).toBe(true);
    expect(
      shouldBlockPostgresBackedApi('/api/flows', {
        WACRM_POSTGRES_APP_API_ENABLED: '1',
      })
    ).toBe(false);
  });

  it('covers every route handler that imports a PostgreSQL repository', () => {
    const repositoryRoutes = listFiles(apiRoot).filter((file) => {
      if (!file.endsWith(`${path.sep}route.ts`)) return false;
      return /from\s+['"]@\/lib\/repositories\//.test(
        readFileSync(file, 'utf8')
      );
    });

    expect(repositoryRoutes.length).toBeGreaterThan(0);
    for (const file of repositoryRoutes) {
      const relative = path.relative(apiRoot, file).split(path.sep).join('/');
      const routePath = `/api/${relative.replace(/\/route\.ts$/, '')}`.replace(
        /\[[^\]]+\]/g,
        'synthetic'
      );
      expect(shouldBlockPostgresBackedApi(routePath), routePath).toBe(true);
    }
  });
});
