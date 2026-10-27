import 'server-only';

import type { QueryResultRow } from 'pg';
import type { Contact, Conversation } from '../../types';
import type { AccountGuardDependencies } from '../auth/postgres-account-guard';
import { createDefaultPostgresAccountGuards } from '../auth/postgres-account-guard';
import { AppError } from '../db/errors';
import { withTransaction } from '../db/postgres-client';

interface ConversationListRow extends QueryResultRow {
  conversation_id: string;
  conversation_user_id: string;
  conversation_contact_id: string;
  conversation_account_id: string;
  conversation_status: string;
  assigned_agent_id: string | null;
  last_message_text: string | null;
  last_message_at: Date | string | null;
  unread_count: number;
  conversation_created_at: Date | string | null;
  conversation_updated_at: Date | string | null;
  contact_id: string;
  contact_user_id: string;
  contact_account_id: string;
  contact_phone: string;
  contact_phone_normalized: string | null;
  contact_name: string | null;
  contact_email: string | null;
  contact_company: string | null;
  contact_avatar_url: string | null;
  contact_created_at: Date | string | null;
  contact_updated_at: Date | string | null;
}

function isUuid(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
      value
    )
  );
}

function uuidString(value: unknown): string {
  if (!isUuid(value)) throw new AppError('db_error');
  return value.toLowerCase();
}

function optionalUuid(value: unknown): string | undefined {
  if (value === null || value === undefined) return undefined;
  return uuidString(value);
}

function requiredString(value: unknown): string {
  if (typeof value !== 'string') throw new AppError('db_error');
  return value;
}

function optionalString(value: unknown): string | undefined {
  if (value === null || value === undefined) return undefined;
  return requiredString(value);
}

function timestampString(value: Date | string | null): string {
  const date = value instanceof Date ? value : new Date(value ?? Number.NaN);
  if (!Number.isFinite(date.getTime())) throw new AppError('db_error');
  return date.toISOString();
}

function optionalTimestampString(
  value: Date | string | null
): string | undefined {
  if (value === null) return undefined;
  return timestampString(value);
}

function isConversationStatus(value: string): value is Conversation['status'] {
  return value === 'open' || value === 'pending' || value === 'closed';
}

function nonNegativeInteger(value: unknown): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) {
    throw new AppError('db_error');
  }
  return value;
}

function toConversation(
  row: ConversationListRow,
  accountId: string
): Conversation {
  const conversationId = uuidString(row.conversation_id);
  const conversationUserId = uuidString(row.conversation_user_id);
  const conversationContactId = uuidString(row.conversation_contact_id);
  const conversationAccountId = uuidString(row.conversation_account_id);
  const contactId = uuidString(row.contact_id);
  const contactUserId = uuidString(row.contact_user_id);
  const contactAccountId = uuidString(row.contact_account_id);

  if (
    conversationAccountId !== accountId.toLowerCase() ||
    contactAccountId !== accountId.toLowerCase() ||
    contactId !== conversationContactId ||
    !isConversationStatus(row.conversation_status)
  ) {
    throw new AppError('db_error');
  }

  const contact: Contact = {
    id: contactId,
    user_id: contactUserId,
    account_id: contactAccountId,
    phone: requiredString(row.contact_phone),
    phone_normalized: optionalString(row.contact_phone_normalized),
    name: optionalString(row.contact_name),
    email: optionalString(row.contact_email),
    company: optionalString(row.contact_company),
    avatar_url: optionalString(row.contact_avatar_url),
    created_at: timestampString(row.contact_created_at),
    updated_at: timestampString(row.contact_updated_at),
  };

  return {
    id: conversationId,
    user_id: conversationUserId,
    contact_id: conversationContactId,
    status: row.conversation_status,
    assigned_agent_id: optionalUuid(row.assigned_agent_id),
    last_message_text: optionalString(row.last_message_text),
    last_message_at: optionalTimestampString(row.last_message_at),
    unread_count: nonNegativeInteger(row.unread_count),
    created_at: timestampString(row.conversation_created_at),
    updated_at: timestampString(row.conversation_updated_at),
    contact,
  };
}

/** Read account conversations and their contact projections from PostgreSQL. */
export function createPostgresConversationListRepository(
  getVerifiedSession: AccountGuardDependencies['getVerifiedSession']
): { listConversations: () => Promise<Conversation[]> } {
  const guards = createDefaultPostgresAccountGuards(getVerifiedSession);

  async function listConversations(): Promise<Conversation[]> {
    const context = await guards.requireAccount();

    const result = await withTransaction(async (transaction) => {
      // Existing RLS policies resolve auth.uid() from this transaction-local GUC.
      await transaction.query(
        "SELECT set_config('request.jwt.claim.sub', $1, true)",
        [context.userId]
      );

      const query = await transaction.query<ConversationListRow>(
        `SELECT
           c.id::text AS conversation_id,
           c.user_id::text AS conversation_user_id,
           c.contact_id::text AS conversation_contact_id,
           c.account_id::text AS conversation_account_id,
           c.status AS conversation_status,
           c.assigned_agent_id::text AS assigned_agent_id,
           c.last_message_text,
           c.last_message_at,
           COALESCE(c.unread_count, 0) AS unread_count,
           c.created_at AS conversation_created_at,
           c.updated_at AS conversation_updated_at,
           ct.id::text AS contact_id,
           ct.user_id::text AS contact_user_id,
           ct.account_id::text AS contact_account_id,
           ct.phone AS contact_phone,
           ct.phone_normalized AS contact_phone_normalized,
           ct.name AS contact_name,
           ct.email AS contact_email,
           ct.company AS contact_company,
           ct.avatar_url AS contact_avatar_url,
           ct.created_at AS contact_created_at,
           ct.updated_at AS contact_updated_at
         FROM public.conversations AS c
         INNER JOIN public.contacts AS ct
           ON ct.id = c.contact_id
          AND ct.account_id = c.account_id
         WHERE c.account_id = $1
           AND ct.account_id = $1
         ORDER BY c.last_message_at DESC NULLS FIRST`,
        [context.accountId]
      );

      return query.rows.map((row) => toConversation(row, context.accountId));
    });

    if (!result.ok) throw result.error;
    return result.data;
  }

  return { listConversations };
}
