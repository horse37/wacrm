import 'server-only';

import type { QueryResultRow } from 'pg';
import type { CustomField } from '../../types';
import type { AccountGuardDependencies } from '../auth/postgres-account-guard';
import { createDefaultPostgresAccountGuards } from '../auth/postgres-account-guard';
import { AppError } from '../db/errors';
import { withTransaction } from '../db/postgres-client';

interface CustomFieldListRow extends QueryResultRow {
  id: string | null;
  user_id: string | null;
  account_id: string | null;
  field_name: string | null;
  field_type: string | null;
  field_options: unknown;
  created_at: Date | string | null;
}

function uuidString(value: unknown): string {
  if (
    typeof value !== 'string' ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
      value
    )
  ) {
    throw new AppError('db_error');
  }
  return value.toLowerCase();
}

function requiredString(value: unknown): string {
  if (typeof value !== 'string') throw new AppError('db_error');
  return value;
}

function fieldOptions(value: unknown): Record<string, unknown> | undefined {
  if (value === null || value === undefined) return undefined;
  if (typeof value !== 'object' || Array.isArray(value)) {
    throw new AppError('db_error');
  }
  return value as Record<string, unknown>;
}

function timestampString(value: Date | string | null): string {
  const date = value instanceof Date ? value : new Date(value ?? Number.NaN);
  if (!Number.isFinite(date.getTime())) throw new AppError('db_error');
  return date.toISOString();
}

function toCustomField(
  row: CustomFieldListRow,
  accountId: string
): CustomField {
  const rowAccountId = uuidString(row.account_id);
  if (rowAccountId !== accountId.toLowerCase()) throw new AppError('db_error');

  const options = fieldOptions(row.field_options);
  return {
    id: uuidString(row.id),
    user_id: uuidString(row.user_id),
    account_id: rowAccountId,
    field_name: requiredString(row.field_name),
    field_type: requiredString(row.field_type),
    ...(options === undefined ? {} : { field_options: options }),
    created_at: timestampString(row.created_at),
  };
}

/** Read custom-field definitions that belong to the verified account. */
export function createPostgresCustomFieldListRepository(
  getVerifiedSession: AccountGuardDependencies['getVerifiedSession']
): { list: () => Promise<CustomField[]> } {
  const guards = createDefaultPostgresAccountGuards(getVerifiedSession);

  async function list(): Promise<CustomField[]> {
    const context = await guards.requireAccount();

    const result = await withTransaction(async (transaction) => {
      // Existing RLS policies resolve auth.uid() from this transaction-local GUC.
      await transaction.query(
        "SELECT set_config('request.jwt.claim.sub', $1, true)",
        [context.userId]
      );

      const query = await transaction.query<CustomFieldListRow>(
        `SELECT
           cf.id::text AS id,
           cf.user_id::text AS user_id,
           cf.account_id::text AS account_id,
           cf.field_name,
           cf.field_type,
           cf.field_options,
           cf.created_at
         FROM public.custom_fields AS cf
         WHERE cf.account_id = $1
         ORDER BY cf.field_name ASC, cf.id ASC`,
        [context.accountId]
      );

      return query.rows.map((row) => toCustomField(row, context.accountId));
    });

    if (!result.ok) throw result.error;
    return result.data;
  }

  return { list };
}
