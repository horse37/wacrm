import 'server-only';
import type { QueryResultRow } from 'pg';
import { AppError } from '../db/errors';
import { withTransaction } from '../db/postgres-client';

interface WebhookCredentialRow extends QueryResultRow {
  accountId: unknown;
  encryptedRegistration: unknown;
}

export interface ZapLeadWebhookCredentialRecord {
  accountId: string;
  encryptedRegistration: string;
}

const keyIdPattern = /^ak_[\da-f]{24}$/i;
const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Resolve one webhook key through forced RLS and column-limited access.
 * The transaction-local key-id GUC is caller-settable by `wacrm_runtime`; it
 * narrows this query as defense in depth, not as an independent auth boundary.
 */
export async function lookupZapLeadWebhookCredential(
  keyId: string
): Promise<ZapLeadWebhookCredentialRecord | null> {
  if (!keyIdPattern.test(keyId)) return null;

  const result = await withTransaction(async (transaction) => {
    await transaction.query(
      "SELECT pg_catalog.set_config('app.wacrm_zap_lead_webhook_key_id', $1, true)",
      [keyId]
    );
    return transaction.query<WebhookCredentialRow>(
      'SELECT account_id AS "accountId", ' +
        'encrypted_registration AS "encryptedRegistration" ' +
        'FROM public.zap_lead_integrations ' +
        'WHERE key_id = $1::text LIMIT 2',
      [keyId]
    );
  });
  if (!result.ok) throw new AppError('db_error');
  if (result.data.rows.length === 0) return null;
  if (result.data.rows.length !== 1) throw new AppError('db_error');

  const row = result.data.rows[0];
  if (
    typeof row.accountId !== 'string' ||
    !uuidPattern.test(row.accountId) ||
    typeof row.encryptedRegistration !== 'string'
  ) {
    throw new AppError('db_error');
  }

  return {
    accountId: row.accountId.toLowerCase(),
    encryptedRegistration: row.encryptedRegistration,
  };
}
