import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AppError, dbFailure, dbSuccess, toAppError } from '../db/errors';

const mocks = vi.hoisted(() => ({
  withTransaction: vi.fn(),
}));

vi.mock('server-only', () => ({}));
vi.mock('../db/postgres-client', () => ({
  withTransaction: mocks.withTransaction,
}));

import type { DbTransaction } from '../db/postgres-client';
import { createPostgresWhatsAppConfigRepository } from './whatsapp-config';

const sessionA = { userId: '00000000-0000-4000-8000-000000000001' };
const accountA = '10000000-0000-4000-8000-000000000001';
const membershipA = {
  userId: sessionA.userId,
  accountId: accountA,
  role: 'viewer',
  accountName: 'Synthetic Account A',
};
const configA = {
  configId: '20000000-0000-4000-8000-000000000001',
  phoneNumberId: 'synthetic-phone-id-a',
  encryptedAccessToken: 'synthetic-ciphertext-a',
  status: 'connected',
};

function setupTransactions({
  role = 'viewer',
  configRows = [configA],
  insertError,
  updateRows = [{ id: configA.configId }],
  updateError,
}: {
  role?: string;
  configRows?: Record<string, unknown>[];
  insertError?: unknown;
  updateRows?: Record<string, unknown>[];
  updateError?: unknown;
} = {}) {
  const transactionQuery = vi.fn(
    async (...args: [sql: string, values?: readonly unknown[]]) => {
      const [sql] = args;
      if (sql.includes('set_config')) return { rows: [], rowCount: 1 };
      if (sql.includes('INNER JOIN public.accounts')) {
        return {
          rows: [{ ...membershipA, role }],
          rowCount: 1,
        };
      }
      if (sql.includes('DELETE FROM public.whatsapp_config')) {
        return { rows: [], rowCount: 1 };
      }
      if (sql.includes('UPDATE public.whatsapp_config')) {
        if (updateError) throw updateError;
        return { rows: updateRows, rowCount: updateRows.length };
      }
      if (sql.includes('INSERT INTO public.whatsapp_config')) {
        if (insertError) throw insertError;
        return { rows: [], rowCount: 1 };
      }
      if (sql.includes('FROM public.whatsapp_config')) {
        return { rows: configRows, rowCount: configRows.length };
      }
      throw new Error(`Unexpected SQL in test: ${sql}`);
    }
  );
  const transaction = { query: transactionQuery } as unknown as DbTransaction;

  mocks.withTransaction.mockImplementation(async (operation) => {
    try {
      return dbSuccess(await operation(transaction));
    } catch (error) {
      return dbFailure(toAppError(error));
    }
  });

  return transactionQuery;
}

describe('PostgreSQL WhatsApp config repository', () => {
  beforeEach(() => {
    mocks.withTransaction.mockReset();
  });

  it('requires a verified session before opening a transaction', async () => {
    const repository = createPostgresWhatsAppConfigRepository(async () => null);

    await expect(repository.getConnectionConfig()).rejects.toEqual(
      new AppError('unauthorized')
    );
    expect(mocks.withTransaction).not.toHaveBeenCalled();
  });

  it('allows a viewer and reads only the encrypted connection fields for its account', async () => {
    const query = setupTransactions();
    const repository = createPostgresWhatsAppConfigRepository(
      async () => sessionA
    );

    await expect(repository.getConnectionConfig()).resolves.toEqual(configA);

    expect(query.mock.calls[0]).toEqual([
      "SELECT set_config('request.jwt.claim.sub', $1, true)",
      [sessionA.userId],
    ]);
    expect(query.mock.calls[2]).toEqual([
      "SELECT set_config('request.jwt.claim.sub', $1, true)",
      [sessionA.userId],
    ]);
    const [sql, values] = query.mock.calls[3] ?? [];
    expect(sql).toContain('FROM public.whatsapp_config');
    expect(sql).toContain('id::text AS "configId"');
    expect(sql).toContain('WHERE account_id = $1');
    expect(sql).not.toMatch(/verify_token|waba_id|user_id/i);
    expect(values).toEqual([accountA]);
  });

  it('returns null when account has no WhatsApp configuration', async () => {
    setupTransactions({ configRows: [] });
    const repository = createPostgresWhatsAppConfigRepository(
      async () => sessionA
    );

    await expect(repository.getConnectionConfig()).resolves.toBeNull();
  });

  it('fails safely when configuration row has no id', async () => {
    setupTransactions({ configRows: [{ ...configA, configId: '' }] });
    const repository = createPostgresWhatsAppConfigRepository(
      async () => sessionA
    );

    await expect(repository.getConnectionConfig()).rejects.toEqual(
      new AppError('db_error')
    );
  });

  it('fails safely if account uniqueness is violated', async () => {
    setupTransactions({
      configRows: [configA, { ...configA, phoneNumberId: 'other' }],
    });
    const repository = createPostgresWhatsAppConfigRepository(
      async () => sessionA
    );

    await expect(repository.getConnectionConfig()).rejects.toEqual(
      new AppError('conflict')
    );
  });

  it('fails safely when database status is outside the existing contract', async () => {
    setupTransactions({
      configRows: [{ ...configA, status: 'connected-ish' }],
    });
    const repository = createPostgresWhatsAppConfigRepository(
      async () => sessionA
    );

    await expect(repository.getConnectionConfig()).rejects.toEqual(
      new AppError('db_error')
    );
  });

  it('fails safely when the encrypted token is missing', async () => {
    setupTransactions({
      configRows: [{ ...configA, encryptedAccessToken: '' }],
    });
    const repository = createPostgresWhatsAppConfigRepository(
      async () => sessionA
    );

    await expect(repository.getConnectionConfig()).rejects.toEqual(
      new AppError('db_error')
    );
  });

  it('propagates safe database errors without exposing driver details', async () => {
    const databaseFailure = new AppError('db_error');
    mocks.withTransaction
      .mockResolvedValueOnce(dbSuccess(membershipA))
      .mockResolvedValueOnce(dbFailure(databaseFailure));
    const repository = createPostgresWhatsAppConfigRepository(
      async () => sessionA
    );

    await expect(repository.getConnectionConfig()).rejects.toBe(
      databaseFailure
    );
  });

  it('updates the legacy token only for the verified account and config id', async () => {
    const query = setupTransactions();
    const repository = createPostgresWhatsAppConfigRepository(
      async () => sessionA
    );

    await expect(
      repository.upgradeLegacyToken(
        configA.configId,
        'synthetic-new-ciphertext'
      )
    ).resolves.toBe(true);

    const updateCall = query.mock.calls.find(([sql]) =>
      sql.includes('UPDATE public.whatsapp_config')
    );
    expect(updateCall).toEqual([
      expect.stringContaining('WHERE id = $1 AND account_id = $2'),
      [configA.configId, accountA, 'synthetic-new-ciphertext'],
    ]);
    expect(query.mock.calls).toContainEqual([
      "SELECT set_config('request.jwt.claim.sub', $1, true)",
      [sessionA.userId],
    ]);
  });

  it('returns false when RLS hides the legacy-token row from the current role', async () => {
    setupTransactions({ updateRows: [] });
    const repository = createPostgresWhatsAppConfigRepository(
      async () => sessionA
    );

    await expect(
      repository.upgradeLegacyToken(
        configA.configId,
        'synthetic-new-ciphertext'
      )
    ).resolves.toBe(false);
  });

  it('requires a verified session before attempting a legacy-token update', async () => {
    const repository = createPostgresWhatsAppConfigRepository(async () => null);

    await expect(
      repository.upgradeLegacyToken(
        configA.configId,
        'synthetic-new-ciphertext'
      )
    ).rejects.toEqual(new AppError('unauthorized'));
    expect(mocks.withTransaction).not.toHaveBeenCalled();
  });
  it('deletes only the current account config for an admin', async () => {
    const query = setupTransactions({ role: 'admin' });
    const repository = createPostgresWhatsAppConfigRepository(
      async () => sessionA
    );

    await expect(repository.deleteConnectionConfig()).resolves.toBeUndefined();

    const deleteCall = query.mock.calls.find(([sql]) =>
      sql.includes('DELETE FROM public.whatsapp_config')
    );
    expect(deleteCall).toEqual([
      expect.stringContaining('WHERE account_id = $1'),
      [accountA],
    ]);
    expect(query.mock.calls).toContainEqual([
      "SELECT set_config('request.jwt.claim.sub', $1, true)",
      [sessionA.userId],
    ]);
  });

  it('denies non-admin membership before attempting a delete', async () => {
    const query = setupTransactions({ role: 'agent' });
    const repository = createPostgresWhatsAppConfigRepository(
      async () => sessionA
    );

    await expect(repository.deleteConnectionConfig()).rejects.toEqual(
      new AppError('forbidden', undefined, 'insufficient_role')
    );
    expect(
      query.mock.calls.some(([sql]) =>
        sql.includes('DELETE FROM public.whatsapp_config')
      )
    ).toBe(false);
  });

  it('requires a verified session before any delete transaction', async () => {
    const repository = createPostgresWhatsAppConfigRepository(async () => null);

    await expect(repository.deleteConnectionConfig()).rejects.toEqual(
      new AppError('unauthorized')
    );
    expect(mocks.withTransaction).not.toHaveBeenCalled();
  });

  it('reads the current admin config registration state by account', async () => {
    const query = setupTransactions({
      role: 'admin',
      configRows: [
        {
          phoneNumberId: 'synthetic-phone-id-a',
          registeredAt: '2026-10-20T12:00:00.000Z',
        },
      ],
    });
    const repository = createPostgresWhatsAppConfigRepository(
      async () => sessionA
    );

    await expect(repository.getRegistrationState()).resolves.toEqual({
      phoneNumberId: 'synthetic-phone-id-a',
      registeredAt: '2026-10-20T12:00:00.000Z',
    });

    const readCall = query.mock.calls.find(([sql]) =>
      sql.includes('FROM public.whatsapp_config')
    );
    expect(readCall).toEqual([
      expect.stringContaining('WHERE account_id = $1'),
      [accountA],
    ]);
    expect(readCall?.[0]).toContain('registered_at');
    expect(readCall?.[0]).not.toMatch(/access_token|verify_token|waba_id/i);
    expect(query.mock.calls).toContainEqual([
      "SELECT set_config('request.jwt.claim.sub', $1, true)",
      [sessionA.userId],
    ]);
  });

  it('requires admin membership before reading config registration state', async () => {
    const query = setupTransactions({ role: 'agent' });
    const repository = createPostgresWhatsAppConfigRepository(
      async () => sessionA
    );

    await expect(repository.getRegistrationState()).rejects.toEqual(
      new AppError('forbidden', undefined, 'insufficient_role')
    );
    expect(
      query.mock.calls.some(([sql]) =>
        sql.includes('FROM public.whatsapp_config')
      )
    ).toBe(false);
  });

  it('upserts encrypted config only for the verified admin account', async () => {
    const query = setupTransactions({ role: 'admin' });
    const repository = createPostgresWhatsAppConfigRepository(
      async () => sessionA
    );
    const config = {
      phoneNumberId: 'synthetic-phone-id-new',
      wabaId: 'synthetic-waba-id',
      encryptedAccessToken: 'synthetic-encrypted-access-token',
      encryptedVerifyToken: 'synthetic-encrypted-verify-token',
      status: 'disconnected' as const,
      connectedAt: null,
      registeredAt: null,
      subscribedAppsAt: null,
      lastRegistrationError: null,
      updatedAt: '2026-10-20T12:00:00.000Z',
    };

    await expect(
      repository.saveConnectionConfig(config)
    ).resolves.toBeUndefined();

    const upsertCall = query.mock.calls.find(([sql]) =>
      sql.includes('INSERT INTO public.whatsapp_config')
    );
    expect(upsertCall?.[0]).toContain('ON CONFLICT (account_id) DO UPDATE');
    expect(upsertCall?.[0]).toContain('phone_number_id');
    expect(upsertCall?.[0]).not.toMatch(/user_id\s*=\s*EXCLUDED\.user_id/i);
    expect(upsertCall?.[1]).toEqual([
      accountA,
      sessionA.userId,
      config.phoneNumberId,
      config.wabaId,
      config.encryptedAccessToken,
      config.encryptedVerifyToken,
      config.status,
      config.connectedAt,
      config.registeredAt,
      config.subscribedAppsAt,
      config.lastRegistrationError,
      config.updatedAt,
    ]);
    expect(query.mock.calls).toContainEqual([
      "SELECT set_config('request.jwt.claim.sub', $1, true)",
      [sessionA.userId],
    ]);
  });

  it('rejects config writes for non-admin membership before INSERT', async () => {
    const query = setupTransactions({ role: 'viewer' });
    const repository = createPostgresWhatsAppConfigRepository(
      async () => sessionA
    );

    await expect(
      repository.saveConnectionConfig({
        phoneNumberId: 'synthetic-phone-id-new',
        wabaId: null,
        encryptedAccessToken: 'synthetic-encrypted-token',
        encryptedVerifyToken: null,
        status: 'connected',
        connectedAt: '2026-10-20T12:00:00.000Z',
        registeredAt: null,
        subscribedAppsAt: null,
        lastRegistrationError: null,
        updatedAt: '2026-10-20T12:00:00.000Z',
      })
    ).rejects.toEqual(
      new AppError('forbidden', undefined, 'insufficient_role')
    );
    expect(
      query.mock.calls.some(([sql]) =>
        sql.includes('INSERT INTO public.whatsapp_config')
      )
    ).toBe(false);
  });

  it('maps the global phone unique constraint to a safe conflict', async () => {
    setupTransactions({ role: 'admin', insertError: { code: '23505' } });
    const repository = createPostgresWhatsAppConfigRepository(
      async () => sessionA
    );

    await expect(
      repository.saveConnectionConfig({
        phoneNumberId: 'synthetic-phone-id-claimed',
        wabaId: null,
        encryptedAccessToken: 'synthetic-encrypted-token',
        encryptedVerifyToken: null,
        status: 'disconnected',
        connectedAt: null,
        registeredAt: null,
        subscribedAppsAt: null,
        lastRegistrationError: null,
        updatedAt: '2026-10-20T12:00:00.000Z',
      })
    ).rejects.toEqual(new AppError('conflict'));
  });
});
