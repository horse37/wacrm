import 'server-only';

import type { QueryResultRow } from 'pg';
import type { ContactTag } from '../../types';
import type { AccountGuardDependencies } from '../auth/postgres-account-guard';
import { createDefaultPostgresAccountGuards } from '../auth/postgres-account-guard';
import { AppError } from '../db/errors';
import { withTransaction } from '../db/postgres-client';

interface ContactTagListRow extends QueryResultRow {
  id: string | null;
  contact_id: string | null;
  tag_id: string | null;
  contact_account_id: string | null;
  tag_account_id: string | null;
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

function toContactTag(
  row: ContactTagListRow,
  accountId: string,
  contactId: string
): ContactTag {
  const rowContactId = uuidString(row.contact_id);
  const contactAccountId = uuidString(row.contact_account_id);
  const tagAccountId = uuidString(row.tag_account_id);
  if (
    rowContactId !== contactId.toLowerCase() ||
    contactAccountId !== accountId.toLowerCase() ||
    tagAccountId !== contactAccountId
  ) {
    throw new AppError('db_error');
  }

  return {
    id: uuidString(row.id),
    contact_id: rowContactId,
    tag_id: uuidString(row.tag_id),
  };
}

/** Read same-account tag assignments for one contact. */
export function createPostgresContactTagsRepository(
  getVerifiedSession: AccountGuardDependencies['getVerifiedSession']
): { listForContact: (contactId: string) => Promise<ContactTag[]> } {
  const guards = createDefaultPostgresAccountGuards(getVerifiedSession);

  async function listForContact(contactIdInput: string): Promise<ContactTag[]> {
    const context = await guards.requireAccount();
    const contactId = requestedUuid(contactIdInput);

    const result = await withTransaction(async (transaction) => {
      // Existing RLS policies resolve auth.uid() from this transaction-local GUC.
      await transaction.query(
        "SELECT set_config('request.jwt.claim.sub', $1, true)",
        [context.userId]
      );

      const query = await transaction.query<ContactTagListRow>(
        `SELECT
           ct.id::text AS id,
           ct.contact_id::text AS contact_id,
           ct.tag_id::text AS tag_id,
           c.account_id::text AS contact_account_id,
           t.account_id::text AS tag_account_id
         FROM public.contact_tags AS ct
         INNER JOIN public.contacts AS c ON c.id = ct.contact_id
         INNER JOIN public.tags AS t
           ON t.id = ct.tag_id
          AND t.account_id = c.account_id
         WHERE c.account_id = $1
           AND ct.contact_id = $2
         ORDER BY ct.created_at ASC NULLS LAST, ct.id ASC`,
        [context.accountId, contactId]
      );

      return query.rows.map((row) =>
        toContactTag(row, context.accountId, contactId)
      );
    });

    if (!result.ok) throw result.error;
    return result.data;
  }

  return { listForContact };
}
