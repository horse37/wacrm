import 'server-only';

import type { QueryResultRow } from 'pg';
import { AppError } from '../db/errors';
import { withTransaction } from '../db/postgres-client';
import type { AccountGuardDependencies } from '../auth/postgres-account-guard';
import { createDefaultPostgresAccountGuards } from '../auth/postgres-account-guard';

export type WhatsAppConnectionStatus = 'connected' | 'disconnected';

export interface WhatsAppConnectionConfig {
  configId: string;
  phoneNumberId: string;
  /** Encrypted database value; decrypt only in trusted server code. */
  encryptedAccessToken: string;
  status: WhatsAppConnectionStatus;
}

export interface WhatsAppRegistrationState {
  phoneNumberId: string;
  registeredAt: Date | string | null;
}

export interface WhatsAppRegistrationDiagnostics {
  phoneNumberId: string;
  wabaId: string | null;
  encryptedAccessToken: string;
  registeredAt: Date | string | null;
  subscribedAppsAt: Date | string | null;
  lastRegistrationError: string | null;
}

export interface WhatsAppConnectionConfigWrite {
  phoneNumberId: string;
  wabaId: string | null;
  encryptedAccessToken: string;
  encryptedVerifyToken: string | null;
  status: WhatsAppConnectionStatus;
  connectedAt: string | null;
  registeredAt: Date | string | null;
  subscribedAppsAt: string | null;
  lastRegistrationError: string | null;
  updatedAt: string;
}

interface WhatsAppConfigRow extends QueryResultRow {
  configId: unknown;
  phoneNumberId: string;
  encryptedAccessToken: string;
  status: string;
}

interface WhatsAppRegistrationStateRow extends QueryResultRow {
  phoneNumberId: unknown;
  registeredAt: Date | string | null;
}

interface WhatsAppRegistrationDiagnosticsRow extends QueryResultRow {
  phoneNumberId: unknown;
  wabaId: unknown;
  encryptedAccessToken: unknown;
  registeredAt: unknown;
  subscribedAppsAt: unknown;
  lastRegistrationError: unknown;
}

function parseConnectionStatus(value: unknown): WhatsAppConnectionStatus {
  if (value === 'connected' || value === 'disconnected') return value;
  throw new AppError('db_error');
}

/** Read the current account's WhatsApp connection material without decrypting it. */
export function createPostgresWhatsAppConfigRepository(
  getVerifiedSession: AccountGuardDependencies['getVerifiedSession']
): {
  getConnectionConfig: () => Promise<WhatsAppConnectionConfig | null>;
  getRegistrationState: () => Promise<WhatsAppRegistrationState | null>;
  getRegistrationDiagnostics: () => Promise<WhatsAppRegistrationDiagnostics | null>;
  saveConnectionConfig: (
    config: WhatsAppConnectionConfigWrite
  ) => Promise<void>;
  upgradeLegacyToken: (
    configId: string,
    encryptedAccessToken: string
  ) => Promise<boolean>;
  deleteConnectionConfig: () => Promise<void>;
} {
  const guards = createDefaultPostgresAccountGuards(getVerifiedSession);

  async function getConnectionConfig(): Promise<WhatsAppConnectionConfig | null> {
    const context = await guards.requireAccount();
    const result = await withTransaction(async (transaction) => {
      // Existing RLS policies resolve auth.uid() from this transaction-local GUC.
      await transaction.query(
        "SELECT set_config('request.jwt.claim.sub', $1, true)",
        [context.userId]
      );

      const query = await transaction.query<WhatsAppConfigRow>(
        `SELECT
           id::text AS "configId",
           phone_number_id AS "phoneNumberId",
           access_token AS "encryptedAccessToken",
           status
         FROM public.whatsapp_config
         WHERE account_id = $1
         LIMIT 2`,
        [context.accountId]
      );

      if (query.rows.length > 1) throw new AppError('conflict');
      const row = query.rows[0];
      if (!row) return null;

      if (
        typeof row.configId !== 'string' ||
        row.configId.length === 0 ||
        typeof row.phoneNumberId !== 'string' ||
        row.phoneNumberId.length === 0 ||
        typeof row.encryptedAccessToken !== 'string' ||
        row.encryptedAccessToken.length === 0
      ) {
        throw new AppError('db_error');
      }

      return {
        configId: row.configId,
        phoneNumberId: row.phoneNumberId,
        encryptedAccessToken: row.encryptedAccessToken,
        status: parseConnectionStatus(row.status),
      };
    });

    if (!result.ok) throw result.error;
    return result.data;
  }

  async function upgradeLegacyToken(
    configId: string,
    encryptedAccessToken: string
  ): Promise<boolean> {
    const context = await guards.requireAccount();
    const result = await withTransaction(async (transaction) => {
      await transaction.query(
        "SELECT set_config('request.jwt.claim.sub', $1, true)",
        [context.userId]
      );

      const updated = await transaction.query(
        'UPDATE public.whatsapp_config SET access_token = $3 WHERE id = $1 AND account_id = $2 RETURNING id',
        [configId, context.accountId, encryptedAccessToken]
      );

      return updated.rows.length === 1;
    });

    if (!result.ok) throw result.error;
    return result.data;
  }
  async function getRegistrationState(): Promise<WhatsAppRegistrationState | null> {
    const context = await guards.requireRole('admin');
    const result = await withTransaction(async (transaction) => {
      await transaction.query(
        "SELECT set_config('request.jwt.claim.sub', $1, true)",
        [context.userId]
      );

      const query = await transaction.query<WhatsAppRegistrationStateRow>(
        `SELECT
           phone_number_id AS "phoneNumberId",
           registered_at AS "registeredAt"
         FROM public.whatsapp_config
         WHERE account_id = $1
         LIMIT 2`,
        [context.accountId]
      );

      if (query.rows.length > 1) throw new AppError('conflict');
      const row = query.rows[0];
      if (!row) return null;
      if (
        typeof row.phoneNumberId !== 'string' ||
        row.phoneNumberId.length === 0 ||
        (row.registeredAt !== null &&
          typeof row.registeredAt !== 'string' &&
          !(row.registeredAt instanceof Date))
      ) {
        throw new AppError('db_error');
      }

      return {
        phoneNumberId: row.phoneNumberId,
        registeredAt: row.registeredAt,
      };
    });

    if (!result.ok) throw result.error;
    return result.data;
  }

  async function getRegistrationDiagnostics(): Promise<WhatsAppRegistrationDiagnostics | null> {
    const context = await guards.requireAccount();
    const result = await withTransaction(async (transaction) => {
      await transaction.query(
        "SELECT set_config('request.jwt.claim.sub', $1, true)",
        [context.userId]
      );

      const query = await transaction.query<WhatsAppRegistrationDiagnosticsRow>(
        `SELECT
           phone_number_id AS "phoneNumberId",
           waba_id AS "wabaId",
           access_token AS "encryptedAccessToken",
           registered_at AS "registeredAt",
           subscribed_apps_at AS "subscribedAppsAt",
           last_registration_error AS "lastRegistrationError"
         FROM public.whatsapp_config
         WHERE account_id = $1
         LIMIT 2`,
        [context.accountId]
      );

      if (query.rows.length > 1) throw new AppError('conflict');
      const row = query.rows[0];
      if (!row) return null;

      const isNullableTimestamp = (
        value: unknown
      ): value is Date | string | null =>
        value === null || typeof value === 'string' || value instanceof Date;
      if (
        typeof row.phoneNumberId !== 'string' ||
        row.phoneNumberId.length === 0 ||
        (row.wabaId !== null && typeof row.wabaId !== 'string') ||
        typeof row.encryptedAccessToken !== 'string' ||
        !isNullableTimestamp(row.registeredAt) ||
        !isNullableTimestamp(row.subscribedAppsAt) ||
        (row.lastRegistrationError !== null &&
          typeof row.lastRegistrationError !== 'string')
      ) {
        throw new AppError('db_error');
      }

      return {
        phoneNumberId: row.phoneNumberId,
        wabaId: row.wabaId,
        encryptedAccessToken: row.encryptedAccessToken,
        registeredAt: row.registeredAt,
        subscribedAppsAt: row.subscribedAppsAt,
        lastRegistrationError: row.lastRegistrationError,
      };
    });

    if (!result.ok) throw result.error;
    return result.data;
  }

  async function saveConnectionConfig(
    config: WhatsAppConnectionConfigWrite
  ): Promise<void> {
    const context = await guards.requireRole('admin');
    const result = await withTransaction(async (transaction) => {
      await transaction.query(
        "SELECT set_config('request.jwt.claim.sub', $1, true)",
        [context.userId]
      );

      await transaction.query(
        `INSERT INTO public.whatsapp_config (
           account_id,
           user_id,
           phone_number_id,
           waba_id,
           access_token,
           verify_token,
           status,
           connected_at,
           registered_at,
           subscribed_apps_at,
           last_registration_error,
           updated_at
         ) VALUES (
           $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12
         )
         ON CONFLICT (account_id) DO UPDATE SET
           phone_number_id = EXCLUDED.phone_number_id,
           waba_id = EXCLUDED.waba_id,
           access_token = EXCLUDED.access_token,
           verify_token = EXCLUDED.verify_token,
           status = EXCLUDED.status,
           connected_at = EXCLUDED.connected_at,
           registered_at = EXCLUDED.registered_at,
           subscribed_apps_at = EXCLUDED.subscribed_apps_at,
           last_registration_error = EXCLUDED.last_registration_error,
           updated_at = EXCLUDED.updated_at`,
        [
          context.accountId,
          context.userId,
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
        ]
      );
    });

    if (!result.ok) throw result.error;
  }

  async function deleteConnectionConfig(): Promise<void> {
    const context = await guards.requireRole('admin');
    const result = await withTransaction(async (transaction) => {
      // Keep the existing forced-RLS identity local to this transaction.
      await transaction.query(
        "SELECT set_config('request.jwt.claim.sub', $1, true)",
        [context.userId]
      );

      await transaction.query(
        `DELETE FROM public.whatsapp_config
         WHERE account_id = $1`,
        [context.accountId]
      );
    });

    if (!result.ok) throw result.error;
  }

  return {
    getConnectionConfig,
    getRegistrationState,
    getRegistrationDiagnostics,
    saveConnectionConfig,
    upgradeLegacyToken,
    deleteConnectionConfig,
  };
}
