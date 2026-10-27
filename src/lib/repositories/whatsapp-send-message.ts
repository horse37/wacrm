import 'server-only';
import type { QueryResultRow } from 'pg';
import { AppError } from '../db/errors';
import { withTransaction } from '../db/postgres-client';

interface SentMessageRow extends QueryResultRow {
  id: string;
}

export interface VerifiedWhatsAppSendMessageAccount {
  userId: string;
  accountId: string;
}

export interface WhatsAppSentMessageInput {
  conversationId: unknown;
  contentType: string;
  contentText: string | null;
  mediaUrl: string | null;
  templateName: string | null;
  providerMessageId: string | null;
  replyToMessageId: unknown;
}

function isUuid(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
      value
    )
  );
}

/** Persist one accepted outbound WhatsApp message inside the verified account. */
export function createPostgresWhatsAppSendMessageRepository(
  account: VerifiedWhatsAppSendMessageAccount
): {
  insertSentMessage: (message: WhatsAppSentMessageInput) => Promise<string>;
} {
  async function insertSentMessage(
    message: WhatsAppSentMessageInput
  ): Promise<string> {
    if (
      !isUuid(account.userId) ||
      !isUuid(account.accountId) ||
      !isUuid(message.conversationId) ||
      (message.replyToMessageId !== null && !isUuid(message.replyToMessageId))
    ) {
      throw new AppError('bad_request');
    }

    const userId = account.userId.toLowerCase();
    const accountId = account.accountId.toLowerCase();
    const conversationId = message.conversationId.toLowerCase();
    const replyToMessageId =
      message.replyToMessageId === null
        ? null
        : message.replyToMessageId.toLowerCase();

    const result = await withTransaction(async (transaction) => {
      await transaction.query(
        "SELECT set_config('request.jwt.claim.sub', $1, true)",
        [userId]
      );

      const inserted = await transaction.query<SentMessageRow>(
        `INSERT INTO public.messages (
           conversation_id,
           sender_type,
           content_type,
           content_text,
           media_url,
           template_name,
           message_id,
           status,
           reply_to_message_id
         )
         SELECT
           c.id,
           'agent',
           $3::text,
           $4::text,
           $5::text,
           $6::text,
           $7::text,
           'sent',
           $8::uuid
         FROM public.conversations AS c
         WHERE c.id = $1::uuid
           AND c.account_id = $2::uuid
         RETURNING id::text AS id`,
        [
          conversationId,
          accountId,
          message.contentType,
          message.contentText,
          message.mediaUrl,
          message.templateName,
          message.providerMessageId,
          replyToMessageId,
        ]
      );

      if (inserted.rows.length !== 1 || !isUuid(inserted.rows[0]?.id)) {
        throw new AppError('db_error');
      }

      return inserted.rows[0].id.toLowerCase();
    });

    if (!result.ok) throw result.error;
    return result.data;
  }

  return { insertSentMessage };
}
