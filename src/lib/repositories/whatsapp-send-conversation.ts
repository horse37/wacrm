import 'server-only';
import type { QueryResultRow } from 'pg';
import { AppError } from '../db/errors';
import { withTransaction } from '../db/postgres-client';

interface SendConversationRow extends QueryResultRow {
  conversation_id: string;
  conversation_account_id: string;
  contact_id: string | null;
  contact_account_id: string | null;
  contact_phone: string | null;
}

interface SendReplyTargetRow extends QueryResultRow {
  message_record_id: string;
  conversation_id: string;
  provider_message_id: string | null;
}

export interface WhatsAppSendConversation {
  contact: { id: string; phone: string | null } | null;
}

export interface WhatsAppSendReplyTarget {
  messageId: string | null;
}

export interface VerifiedWhatsAppSendAccount {
  userId: string;
  accountId: string;
}

export interface WhatsAppSendConversationUpdate {
  conversationId: unknown;
  lastMessageText: unknown;
  lastMessageAt: unknown;
  updatedAt: unknown;
}

interface SendConversationUpdateRow extends QueryResultRow {
  id: string;
}

function isUuid(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
      value
    )
  );
}

/** Read one send target from PostgreSQL within an already verified account. */
export function createPostgresWhatsAppSendConversationRepository(
  account: VerifiedWhatsAppSendAccount
): {
  findForSend: (
    conversationId: unknown
  ) => Promise<WhatsAppSendConversation | null>;
  findReplyTarget: (
    conversationId: unknown,
    replyToMessageId: unknown
  ) => Promise<WhatsAppSendReplyTarget | null>;
  updateContactPhone: (contactId: unknown, phone: unknown) => Promise<boolean>;
  updateAfterSend: (input: WhatsAppSendConversationUpdate) => Promise<boolean>;
} {
  async function findForSend(
    conversationId: unknown
  ): Promise<WhatsAppSendConversation | null> {
    if (!isUuid(conversationId)) return null;

    const normalizedConversationId = conversationId.toLowerCase();
    const normalizedAccountId = account.accountId.toLowerCase();
    const result = await withTransaction(async (transaction) => {
      await transaction.query(
        "SELECT set_config('request.jwt.claim.sub', $1, true)",
        [account.userId]
      );

      const lookup = await transaction.query<SendConversationRow>(
        `SELECT
           c.id::text AS conversation_id,
           c.account_id::text AS conversation_account_id,
           ct.id::text AS contact_id,
           ct.account_id::text AS contact_account_id,
           ct.phone AS contact_phone
         FROM public.conversations AS c
         LEFT JOIN public.contacts AS ct
           ON ct.id = c.contact_id
          AND ct.account_id = c.account_id
         WHERE c.id = $1::uuid
           AND c.account_id = $2::uuid
         LIMIT 1`,
        [normalizedConversationId, normalizedAccountId]
      );

      return lookup.rows[0] ?? null;
    });

    if (!result.ok) throw result.error;
    if (!result.data) return null;

    const row = result.data;
    if (
      !isUuid(row.conversation_id) ||
      row.conversation_id.toLowerCase() !== normalizedConversationId ||
      !isUuid(row.conversation_account_id) ||
      row.conversation_account_id.toLowerCase() !== normalizedAccountId
    ) {
      throw new AppError('db_error');
    }

    if (row.contact_id === null) return { contact: null };

    if (
      !isUuid(row.contact_id) ||
      !isUuid(row.contact_account_id) ||
      row.contact_account_id.toLowerCase() !== normalizedAccountId ||
      (row.contact_phone !== null && typeof row.contact_phone !== 'string')
    ) {
      throw new AppError('db_error');
    }

    return {
      contact: {
        id: row.contact_id.toLowerCase(),
        phone: row.contact_phone,
      },
    };
  }

  async function findReplyTarget(
    conversationId: unknown,
    replyToMessageId: unknown
  ): Promise<WhatsAppSendReplyTarget | null> {
    if (!isUuid(conversationId) || !isUuid(replyToMessageId)) return null;

    const normalizedConversationId = conversationId.toLowerCase();
    const normalizedReplyToMessageId = replyToMessageId.toLowerCase();
    const normalizedAccountId = account.accountId.toLowerCase();
    const result = await withTransaction(async (transaction) => {
      await transaction.query(
        "SELECT set_config('request.jwt.claim.sub', $1, true)",
        [account.userId]
      );

      const lookup = await transaction.query<SendReplyTargetRow>(
        `SELECT
           m.id::text AS message_record_id,
           c.id::text AS conversation_id,
           m.message_id AS provider_message_id
         FROM public.messages AS m
         INNER JOIN public.conversations AS c ON c.id = m.conversation_id
         WHERE m.id = $1::uuid
           AND c.id = $2::uuid
           AND c.account_id = $3::uuid
         LIMIT 1`,
        [
          normalizedReplyToMessageId,
          normalizedConversationId,
          normalizedAccountId,
        ]
      );

      return lookup.rows[0] ?? null;
    });

    if (!result.ok) throw result.error;
    if (!result.data) return null;

    const row = result.data;
    if (
      !isUuid(row.message_record_id) ||
      row.message_record_id.toLowerCase() !== normalizedReplyToMessageId ||
      !isUuid(row.conversation_id) ||
      row.conversation_id.toLowerCase() !== normalizedConversationId ||
      (row.provider_message_id !== null &&
        typeof row.provider_message_id !== 'string')
    ) {
      throw new AppError('db_error');
    }

    return { messageId: row.provider_message_id };
  }

  async function updateContactPhone(
    contactId: unknown,
    phone: unknown
  ): Promise<boolean> {
    if (!isUuid(contactId) || typeof phone !== 'string' || phone.length === 0) {
      return false;
    }

    const normalizedContactId = contactId.toLowerCase();
    const normalizedAccountId = account.accountId.toLowerCase();
    const result = await withTransaction(async (transaction) => {
      await transaction.query(
        "SELECT set_config('request.jwt.claim.sub', $1, true)",
        [account.userId]
      );

      const updated = await transaction.query(
        `UPDATE public.contacts
         SET phone = $3
         WHERE id = $1::uuid
           AND account_id = $2::uuid
         RETURNING id`,
        [normalizedContactId, normalizedAccountId, phone]
      );

      if (updated.rows.length > 1) throw new AppError('db_error');
      return updated.rows.length === 1;
    });

    if (!result.ok) throw result.error;
    return result.data;
  }

  async function updateAfterSend(
    input: WhatsAppSendConversationUpdate
  ): Promise<boolean> {
    if (
      !isUuid(account.userId) ||
      !isUuid(account.accountId) ||
      !isUuid(input.conversationId) ||
      typeof input.lastMessageText !== 'string' ||
      typeof input.lastMessageAt !== 'string' ||
      !Number.isFinite(Date.parse(input.lastMessageAt)) ||
      typeof input.updatedAt !== 'string' ||
      !Number.isFinite(Date.parse(input.updatedAt))
    ) {
      return false;
    }

    const userId = account.userId.toLowerCase();
    const accountId = account.accountId.toLowerCase();
    const conversationId = input.conversationId.toLowerCase();
    const result = await withTransaction(async (transaction) => {
      await transaction.query(
        "SELECT set_config('request.jwt.claim.sub', $1, true)",
        [userId]
      );

      const updated = await transaction.query<SendConversationUpdateRow>(
        `UPDATE public.conversations
         SET last_message_text = $3::text,
             last_message_at = $4::timestamptz,
             updated_at = $5::timestamptz
         WHERE id = $1::uuid
           AND account_id = $2::uuid
         RETURNING id::text AS id`,
        [
          conversationId,
          accountId,
          input.lastMessageText,
          input.lastMessageAt,
          input.updatedAt,
        ]
      );

      if (updated.rows.length === 0) return false;
      if (
        updated.rows.length !== 1 ||
        !isUuid(updated.rows[0]?.id) ||
        updated.rows[0].id.toLowerCase() !== conversationId
      ) {
        throw new AppError('db_error');
      }

      return true;
    });

    if (!result.ok) throw result.error;
    return result.data;
  }

  return {
    findForSend,
    findReplyTarget,
    updateContactPhone,
    updateAfterSend,
  };
}
