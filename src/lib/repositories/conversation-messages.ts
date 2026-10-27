import 'server-only';

import type { QueryResultRow } from 'pg';
import type { Message } from '../../types';
import type { AccountGuardDependencies } from '../auth/postgres-account-guard';
import { createDefaultPostgresAccountGuards } from '../auth/postgres-account-guard';
import { AppError } from '../db/errors';
import { withTransaction } from '../db/postgres-client';

interface ConversationMessageRow extends QueryResultRow {
  id: string;
  conversation_id: string;
  sender_type: string;
  sender_id: string | null;
  content_type: string;
  content_text: string | null;
  media_url: string | null;
  template_name: string | null;
  message_id: string | null;
  status: string;
  created_at: Date | string | null;
  reply_to_message_id: string | null;
  interactive_reply_id: string | null;
}

function isUuid(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
      value
    )
  );
}

function isSenderType(value: string): value is Message['sender_type'] {
  return value === 'customer' || value === 'agent' || value === 'bot';
}

function isContentType(value: string): value is Message['content_type'] {
  return [
    'text',
    'image',
    'document',
    'audio',
    'video',
    'location',
    'template',
    'interactive',
  ].includes(value);
}

function isMessageStatus(value: string): value is Message['status'] {
  return (
    value === 'sending' ||
    value === 'sent' ||
    value === 'delivered' ||
    value === 'read' ||
    value === 'failed'
  );
}

function optionalString(value: unknown): string | undefined {
  if (value === null || value === undefined) return undefined;
  if (typeof value !== 'string') throw new AppError('db_error');
  return value;
}

function timestampString(value: Date | string | null): string {
  const date = value instanceof Date ? value : new Date(value ?? Number.NaN);
  if (!Number.isFinite(date.getTime())) throw new AppError('db_error');
  return date.toISOString();
}

function toMessage(
  row: ConversationMessageRow,
  conversationId: string
): Message {
  if (
    !isUuid(row.id) ||
    !isUuid(row.conversation_id) ||
    row.conversation_id.toLowerCase() !== conversationId.toLowerCase() ||
    !isSenderType(row.sender_type) ||
    !isContentType(row.content_type) ||
    !isMessageStatus(row.status)
  ) {
    throw new AppError('db_error');
  }

  return {
    id: row.id.toLowerCase(),
    conversation_id: row.conversation_id.toLowerCase(),
    sender_type: row.sender_type,
    sender_id: optionalString(row.sender_id),
    content_type: row.content_type,
    content_text: optionalString(row.content_text),
    media_url: optionalString(row.media_url),
    template_name: optionalString(row.template_name),
    message_id: optionalString(row.message_id),
    status: row.status,
    created_at: timestampString(row.created_at),
    reply_to_message_id: optionalString(row.reply_to_message_id),
    interactive_reply_id: optionalString(row.interactive_reply_id),
  };
}

/** Read conversation history within the caller's verified PostgreSQL account. */
export function createPostgresConversationMessagesRepository(
  getVerifiedSession: AccountGuardDependencies['getVerifiedSession']
): { listForConversation: (conversationId: string) => Promise<Message[]> } {
  const guards = createDefaultPostgresAccountGuards(getVerifiedSession);

  async function listForConversation(
    conversationId: string
  ): Promise<Message[]> {
    const context = await guards.requireAccount();
    if (!isUuid(conversationId)) throw new AppError('not_found');

    const result = await withTransaction(async (transaction) => {
      // Existing RLS policies resolve auth.uid() from this transaction-local GUC.
      await transaction.query(
        "SELECT set_config('request.jwt.claim.sub', $1, true)",
        [context.userId]
      );

      const query = await transaction.query<ConversationMessageRow>(
        `SELECT
           m.id::text AS id,
           m.conversation_id::text AS conversation_id,
           m.sender_type,
           m.sender_id::text AS sender_id,
           m.content_type,
           m.content_text,
           m.media_url,
           m.template_name,
           m.message_id,
           m.status,
           m.created_at,
           m.reply_to_message_id::text AS reply_to_message_id,
           m.interactive_reply_id
         FROM public.messages AS m
         INNER JOIN public.conversations AS c ON c.id = m.conversation_id
         WHERE c.id = $1
           AND c.account_id = $2
         ORDER BY m.created_at ASC`,
        [conversationId.toLowerCase(), context.accountId]
      );

      return query.rows.map((row) => toMessage(row, conversationId));
    });

    if (!result.ok) throw result.error;
    return result.data;
  }

  return { listForConversation };
}
