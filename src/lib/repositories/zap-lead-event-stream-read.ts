import 'server-only';

import type { QueryResultRow } from 'pg';
import { AppError } from '../db/errors';
import { withTransaction } from '../db/postgres-client';

interface IntegrationRow extends QueryResultRow {
  accountId: unknown;
  apiBaseUrl: unknown;
  encryptedRegistration: unknown;
}

interface CursorRow extends QueryResultRow {
  cursor: unknown;
}

export interface ZapLeadEventStreamReadAccount {
  userId: string;
  accountId: string;
}

export interface ZapLeadEventStreamIntegration {
  accountId: string;
  apiBaseUrl: string;
  encryptedRegistration: string;
}

function isUuid(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
      value
    )
  );
}

/** Read event-stream setup fields under the verified account identity. */
export function createPostgresZapLeadEventStreamReadRepository(
  account: ZapLeadEventStreamReadAccount
): {
  getIntegration: () => Promise<ZapLeadEventStreamIntegration | null>;
  getCursor: (keyId: unknown) => Promise<string | null>;
} {
  async function withAccountIdentity<T>(
    read: Parameters<typeof withTransaction<T>>[0]
  ): ReturnType<typeof withTransaction<T>> {
    if (!isUuid(account.userId) || !isUuid(account.accountId)) {
      throw new AppError('db_error');
    }

    const userId = account.userId.toLowerCase();
    return withTransaction(async (transaction) => {
      await transaction.query(
        "SELECT set_config('request.jwt.claim.sub', $1, true)",
        [userId]
      );
      return read(transaction);
    });
  }

  async function getIntegration(): Promise<ZapLeadEventStreamIntegration | null> {
    const accountId = account.accountId.toLowerCase();
    const result = await withAccountIdentity(async (transaction) => {
      const lookup = await transaction.query<IntegrationRow>(
        'SELECT account_id AS "accountId", api_base_url AS "apiBaseUrl", ' +
          'encrypted_registration AS "encryptedRegistration" ' +
          'FROM public.zap_lead_integrations ' +
          'WHERE account_id = $1::uuid LIMIT 2',
        [accountId]
      );
      if (lookup.rows.length > 1) throw new AppError('db_error');
      return lookup.rows[0] ?? null;
    });

    if (!result.ok) throw result.error;
    if (!result.data) return null;
    if (
      !isUuid(result.data.accountId) ||
      result.data.accountId.toLowerCase() !== accountId ||
      typeof result.data.apiBaseUrl !== 'string' ||
      typeof result.data.encryptedRegistration !== 'string'
    ) {
      throw new AppError('db_error');
    }

    return {
      accountId: result.data.accountId.toLowerCase(),
      apiBaseUrl: result.data.apiBaseUrl,
      encryptedRegistration: result.data.encryptedRegistration,
    };
  }

  async function getCursor(keyId: unknown): Promise<string | null> {
    if (typeof keyId !== 'string' || keyId.length === 0) return null;

    const accountId = account.accountId.toLowerCase();
    const result = await withAccountIdentity(async (transaction) => {
      const lookup = await transaction.query<CursorRow>(
        'SELECT last_sse_cursor_id AS "cursor" ' +
          'FROM public.zap_lead_integration_state ' +
          'WHERE account_id = $1::uuid AND integration_key_id = $2::text LIMIT 2',
        [accountId, keyId]
      );
      if (lookup.rows.length > 1) throw new AppError('db_error');
      return lookup.rows[0] ?? null;
    });

    if (!result.ok) throw result.error;
    if (!result.data || result.data.cursor === null) return null;
    if (typeof result.data.cursor !== 'string') throw new AppError('db_error');
    return result.data.cursor;
  }

  return { getIntegration, getCursor };
}
