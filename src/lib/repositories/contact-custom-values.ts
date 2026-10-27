import 'server-only';

import type { QueryResultRow } from 'pg';
import type { ContactCustomValue } from '../../types';
import type { AccountGuardDependencies } from '../auth/postgres-account-guard';
import { createDefaultPostgresAccountGuards } from '../auth/postgres-account-guard';
import { AppError } from '../db/errors';
import { withTransaction } from '../db/postgres-client';

interface ContactCustomValueListRow extends QueryResultRow {
  id: string | null;
  contact_id: string | null;
  custom_field_id: string | null;
  value: string | null;
  contact_account_id: string | null;
  field_account_id: string | null;
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

function requestedUuid(value: unknown): string {
  try {
    return uuidString(value);
  } catch {
    throw new AppError('bad_request');
  }
}

function toContactCustomValue(
  row: ContactCustomValueListRow,
  accountId: string,
  contactId: string
): ContactCustomValue {
  const rowContactId = uuidString(row.contact_id);
  const contactAccountId = uuidString(row.contact_account_id);
  const fieldAccountId = uuidString(row.field_account_id);
  if (
    rowContactId !== contactId.toLowerCase() ||
    contactAccountId !== accountId.toLowerCase() ||
    fieldAccountId !== contactAccountId
  ) {
    throw new AppError('db_error');
  }

  const value = row.value;
  if (value !== null && value !== undefined && typeof value !== 'string') {
    throw new AppError('db_error');
  }

  return {
    id: uuidString(row.id),
    contact_id: rowContactId,
    custom_field_id: uuidString(row.custom_field_id),
    ...(value === null || value === undefined ? {} : { value }),
  };
}

/** Read custom-field values for a contact in the verified account. */
export function createPostgresContactCustomValuesRepository(
  getVerifiedSession: AccountGuardDependencies['getVerifiedSession']
): { listForContact: (contactId: string) => Promise<ContactCustomValue[]> } {
  const guards = createDefaultPostgresAccountGuards(getVerifiedSession);

  async function listForContact(
    contactIdInput: string
  ): Promise<ContactCustomValue[]> {
    const context = await guards.requireAccount();
    const contactId = requestedUuid(contactIdInput);

    const result = await withTransaction(async (transaction) => {
      // Existing RLS policies resolve auth.uid() from this transaction-local GUC.
      await transaction.query(
        "SELECT set_config('request.jwt.claim.sub', $1, true)",
        [context.userId]
      );

      const query = await transaction.query<ContactCustomValueListRow>(
        `SELECT
           ccv.id::text AS id,
           ccv.contact_id::text AS contact_id,
           ccv.custom_field_id::text AS custom_field_id,
           ccv.value,
           c.account_id::text AS contact_account_id,
           cf.account_id::text AS field_account_id
         FROM public.contact_custom_values AS ccv
         INNER JOIN public.contacts AS c ON c.id = ccv.contact_id
         INNER JOIN public.custom_fields AS cf
           ON cf.id = ccv.custom_field_id
          AND cf.account_id = c.account_id
         WHERE c.account_id = $1
           AND ccv.contact_id = $2
         ORDER BY ccv.custom_field_id ASC, ccv.id ASC`,
        [context.accountId, contactId]
      );

      return query.rows.map((row) =>
        toContactCustomValue(row, context.accountId, contactId)
      );
    });

    if (!result.ok) throw result.error;
    return result.data;
  }

  return { listForContact };
}
