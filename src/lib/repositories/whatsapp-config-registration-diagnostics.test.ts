import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AppError, dbFailure, dbSuccess, toAppError } from '../db/errors';
import type { DbTransaction } from '../db/postgres-client';

const mocks = vi.hoisted(() => ({
  withTransaction: vi.fn(),
  requireAccount: vi.fn(),
}));

vi.mock('server-only', () => ({}));
vi.mock('../db/postgres-client', () => ({
  withTransaction: mocks.withTransaction,
}));
vi.mock('../auth/postgres-account-guard', () => ({
  createDefaultPostgresAccountGuards: () => ({
    requireAccount: mocks.requireAccount,
    requireRole: vi.fn(),
  }),
}));

import { createPostgresWhatsAppConfigRepository } from './whatsapp-config';

const userId = '00000000-0000-4000-8000-000000000001';
const accountId = '10000000-0000-4000-8000-000000000001';
const context = {
  userId,
  accountId,
  role: 'viewer' as const,
  account: { id: accountId, name: 'Synthetic Account' },
};
const registrationDiagnostics = {
  phoneNumberId: 'synthetic-phone-id',
  wabaId: 'synthetic-waba-id',
  encryptedAccessToken: 'synthetic-encrypted-access-token',
  registeredAt: '2026-10-20T12:00:00.000Z',
  subscribedAppsAt: '2026-10-20T12:01:00.000Z',
  lastRegistrationError: null,
};

function setup(rows: Record<string, unknown>[] = [registrationDiagnostics]) {
  const query = vi.fn(async (sql: string) => {
    if (sql.includes('set_config')) return { rows: [], rowCount: 1 };
    return { rows, rowCount: rows.length };
  });
  mocks.withTransaction.mockImplementation(async (work) => {
    try {
      return dbSuccess(await work({ query } as unknown as DbTransaction));
    } catch (error) {
      return dbFailure(toAppError(error));
    }
  });
  return query;
}

describe('PostgreSQL WhatsApp registration diagnostics repository', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireAccount.mockResolvedValue(context);
  });

  it('reads only diagnostic fields scoped to the verified account with transaction-local identity', async () => {
    const query = setup();
    const repository = createPostgresWhatsAppConfigRepository(async () => ({
      userId,
    }));

    await expect(repository.getRegistrationDiagnostics()).resolves.toEqual(
      registrationDiagnostics
    );

    expect(mocks.requireAccount).toHaveBeenCalledOnce();
    expect(query).toHaveBeenNthCalledWith(
      1,
      "SELECT set_config('request.jwt.claim.sub', $1, true)",
      [userId]
    );
    expect(query).toHaveBeenNthCalledWith(
      2,
      expect.stringContaining('WHERE account_id = $1'),
      [accountId]
    );
    const selectSql = query.mock.calls[1]?.[0] ?? '';
    expect(selectSql).toContain('phone_number_id');
    expect(selectSql).toContain('waba_id');
    expect(selectSql).toContain('access_token');
    expect(selectSql).toContain('registered_at');
    expect(selectSql).toContain('subscribed_apps_at');
    expect(selectSql).toContain('last_registration_error');
    expect(selectSql).not.toMatch(/verify_token|user_id/i);
  });

  it('returns null when the account has no WhatsApp configuration', async () => {
    setup([]);
    const repository = createPostgresWhatsAppConfigRepository(async () => ({
      userId,
    }));

    await expect(repository.getRegistrationDiagnostics()).resolves.toBeNull();
  });

  it('rejects duplicate account rows as a data conflict', async () => {
    setup([registrationDiagnostics, registrationDiagnostics]);
    const repository = createPostgresWhatsAppConfigRepository(async () => ({
      userId,
    }));

    await expect(repository.getRegistrationDiagnostics()).rejects.toEqual(
      new AppError('conflict')
    );
  });

  it('does not query WhatsApp configuration when the verified user has no account membership', async () => {
    const query = setup();
    mocks.requireAccount.mockRejectedValue(new AppError('forbidden'));
    const repository = createPostgresWhatsAppConfigRepository(async () => ({
      userId,
    }));

    await expect(repository.getRegistrationDiagnostics()).rejects.toEqual(
      new AppError('forbidden')
    );
    expect(query).not.toHaveBeenCalled();
    expect(mocks.withTransaction).not.toHaveBeenCalled();
  });

  it('rejects malformed diagnostic fields without exposing row contents', async () => {
    setup([{ ...registrationDiagnostics, subscribedAppsAt: true }]);
    const repository = createPostgresWhatsAppConfigRepository(async () => ({
      userId,
    }));

    await expect(repository.getRegistrationDiagnostics()).rejects.toEqual(
      new AppError('db_error')
    );
  });
});
