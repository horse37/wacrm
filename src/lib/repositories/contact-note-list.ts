import 'server-only';

import type { QueryResultRow } from 'pg';
import type { ContactNote } from '../../types';
import type { AccountGuardDependencies } from '../auth/postgres-account-guard';
import { createDefaultPostgresAccountGuards } from '../auth/postgres-account-guard';
import { AppError } from '../db/errors';
import { withTransaction } from '../db/postgres-client';

interface ContactNoteListRow extends QueryResultRow {
  id: string | null;
  contact_id: string | null;
  user_id: string | null;
  account_id: string | null;
  contact_account_id: string | null;
  note_text: string | null;
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

function requestedUuid(value: unknown): string {
  try {
    return uuidString(value);
  } catch {
    throw new AppError('bad_request');
  }
}

function requiredString(value: unknown): string {
  if (typeof value !== 'string') throw new AppError('db_error');
  return value;
}

function timestampString(value: Date | string | null): string {
  const date = value instanceof Date ? value : new Date(value ?? Number.NaN);
  if (!Number.isFinite(date.getTime())) throw new AppError('db_error');
  return date.toISOString();
}

function toContactNote(
  row: ContactNoteListRow,
  accountId: string,
  contactId: string
): ContactNote {
  const rowContactId = uuidString(row.contact_id);
  const rowAccountId = uuidString(row.account_id);
  const contactAccountId = uuidString(row.contact_account_id);
  if (
    rowContactId !== contactId.toLowerCase() ||
    rowAccountId !== accountId.toLowerCase() ||
    contactAccountId !== rowAccountId
  ) {
    throw new AppError('db_error');
  }

  return {
    id: uuidString(row.id),
    contact_id: rowContactId,
    user_id: uuidString(row.user_id),
    note_text: requiredString(row.note_text),
    created_at: timestampString(row.created_at),
  };
}

/** Read notes for a contact in the verified account, newest first. */
export function createPostgresContactNoteListRepository(
  getVerifiedSession: AccountGuardDependencies['getVerifiedSession']
): { listForContact: (contactId: string) => Promise<ContactNote[]> } {
  const guards = createDefaultPostgresAccountGuards(getVerifiedSession);

  async function listForContact(
    contactIdInput: string
  ): Promise<ContactNote[]> {
    const context = await guards.requireAccount();
    const contactId = requestedUuid(contactIdInput);

    const result = await withTransaction(async (transaction) => {
      // Existing RLS policies resolve auth.uid() from this transaction-local GUC.
      await transaction.query(
        "SELECT set_config('request.jwt.claim.sub', $1, true)",
        [context.userId]
      );

      const query = await transaction.query<ContactNoteListRow>(
        `SELECT
           n.id::text AS id,
           n.contact_id::text AS contact_id,
           n.user_id::text AS user_id,
           n.account_id::text AS account_id,
           c.account_id::text AS contact_account_id,
           n.note_text,
           n.created_at
         FROM public.contact_notes AS n
         INNER JOIN public.contacts AS c
           ON c.id = n.contact_id
          AND c.account_id = n.account_id
         WHERE n.account_id = $1
           AND n.contact_id = $2
         ORDER BY n.created_at DESC NULLS LAST, n.id DESC`,
        [context.accountId, contactId]
      );

      return query.rows.map((row) =>
        toContactNote(row, context.accountId, contactId)
      );
    });

    if (!result.ok) throw result.error;
    return result.data;
  }

  return { listForContact };
}
