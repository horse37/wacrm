import 'server-only';

import type { QueryResultRow } from 'pg';
import { AppError } from '../db/errors';
import { withTransaction } from '../db/postgres-client';

interface ZapLeadIntegrationRow extends QueryResultRow {
  apiBaseUrl: unknown;
  keyId: unknown;
}

interface ZapLeadHeartbeatRow extends QueryResultRow {
  lastSuccessAt: unknown;
  lastFailureAt: unknown;
  lastErrorCode: unknown;
  alertSentAt: unknown;
}

export interface ZapLeadRegistrationReadAccount {
  userId: string;
  accountId: string;
}

export interface ZapLeadRegistrationIntegration {
  apiBaseUrl: string;
  keyId: string | null;
}

export interface ZapLeadRegistrationHeartbeatState {
  lastSuccessAt: Date | string | null;
  lastFailureAt: Date | string | null;
  lastErrorCode: string | null;
  alertSentAt: Date | string | null;
}

function isUuid(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
      value
    )
  );
}

function nullableTimestamp(value: unknown): Date | string | null {
  if (value === null) return null;
  if (value instanceof Date && Number.isFinite(value.getTime())) return value;
  if (typeof value === 'string' && Number.isFinite(Date.parse(value))) {
    return value;
  }
  throw new AppError('db_error');
}

function nullableString(value: unknown): string | null {
  if (value === null || typeof value === 'string') return value;
  throw new AppError('db_error');
}

/** Read published Zap Lead registration fields inside the verified account. */
export function createPostgresZapLeadRegistrationReadRepository(
  account: ZapLeadRegistrationReadAccount
): {
  getIntegration: () => Promise<ZapLeadRegistrationIntegration | null>;
  getHeartbeatState: (
    keyId: unknown
  ) => Promise<ZapLeadRegistrationHeartbeatState | null>;
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

  async function getIntegration(): Promise<ZapLeadRegistrationIntegration | null> {
    const accountId = account.accountId.toLowerCase();
    const result = await withAccountIdentity(async (transaction) => {
      const lookup = await transaction.query<ZapLeadIntegrationRow>(
        `SELECT api_base_url AS "apiBaseUrl", key_id AS "keyId"
         FROM public.zap_lead_integrations
         WHERE account_id = $1::uuid
         LIMIT 2`,
        [accountId]
      );
      if (lookup.rows.length > 1) throw new AppError('db_error');
      return lookup.rows[0] ?? null;
    });

    if (!result.ok) throw result.error;
    if (!result.data) return null;
    if (
      typeof result.data.apiBaseUrl !== 'string' ||
      (result.data.keyId !== null && typeof result.data.keyId !== 'string')
    ) {
      throw new AppError('db_error');
    }

    return {
      apiBaseUrl: result.data.apiBaseUrl,
      keyId: result.data.keyId,
    };
  }

  async function getHeartbeatState(
    keyId: unknown
  ): Promise<ZapLeadRegistrationHeartbeatState | null> {
    if (typeof keyId !== 'string' || keyId.length === 0) return null;
    if (!isUuid(account.userId) || !isUuid(account.accountId)) {
      throw new AppError('db_error');
    }

    const userId = account.userId.toLowerCase();
    const accountId = account.accountId.toLowerCase();
    const result = await withTransaction(async (transaction) => {
      await transaction.query(
        "SELECT set_config('request.jwt.claim.sub', $1, true)",
        [userId]
      );
      const lookup = await transaction.query<ZapLeadHeartbeatRow>(
        `SELECT last_success_at AS "lastSuccessAt",
                last_failure_at AS "lastFailureAt",
                last_error_code AS "lastErrorCode",
                alert_sent_at AS "alertSentAt"
         FROM public.zap_lead_integration_state
         WHERE account_id = $1::uuid
           AND integration_key_id = $2::text
         LIMIT 2`,
        [accountId, keyId]
      );
      if (lookup.rows.length > 1) throw new AppError('db_error');
      return lookup.rows[0] ?? null;
    });

    if (!result.ok) throw result.error;
    if (!result.data) return null;

    return {
      lastSuccessAt: nullableTimestamp(result.data.lastSuccessAt),
      lastFailureAt: nullableTimestamp(result.data.lastFailureAt),
      lastErrorCode: nullableString(result.data.lastErrorCode),
      alertSentAt: nullableTimestamp(result.data.alertSentAt),
    };
  }

  return { getIntegration, getHeartbeatState };
}
