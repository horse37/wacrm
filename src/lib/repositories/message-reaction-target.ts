import 'server-only';

import type { QueryResultRow } from 'pg';
import type { AccountGuardDependencies } from '../auth/postgres-account-guard';
import { createDefaultPostgresAccountGuards } from '../auth/postgres-account-guard';
import { AppError } from '../db/errors';
import { withTransaction } from '../db/postgres-client';

interface MessageReactionTargetRow extends QueryResultRow {
  providerMessageId: unknown;
  contactPhone: unknown;
}

export interface MessageReactionTarget {
  providerMessageId: string | null;
  contactPhone: string | null;
}

const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function requestedUuid(value: unknown): string {
  if (typeof value !== 'string' || !uuidPattern.test(value)) {
    throw new AppError('bad_request');
  }
  return value.toLowerCase();
}

function optionalDatabaseText(value: unknown): string | null {
  if (value === null) return null;
  if (typeof value !== 'string') throw new AppError('db_error');
  if (value.trim().length === 0) return null;
  return value;
}

/** Resolve only the provider message ID and contact phone needed by the reaction handler. */
export function createPostgresMessageReactionTargetRepository(
  getVerifiedSession: AccountGuardDependencies['getVerifiedSession']
): {
  getTarget: (messageId: string) => Promise<MessageReactionTarget>;
} {
  const guards = createDefaultPostgresAccountGuards(getVerifiedSession);

  async function getTarget(
    messageIdInput: string
  ): Promise<MessageReactionTarget> {
    const context = await guards.requireRole('agent');
    const messageId = requestedUuid(messageIdInput);

    const result = await withTransaction(async (transaction) => {
      // Existing RLS policies resolve auth.uid() from this transaction-local GUC.
      await transaction.query(
        "SELECT set_config('request.jwt.claim.sub', $1, true)",
        [context.userId]
      );

      const query = await transaction.query<MessageReactionTargetRow>(
        `SELECT
           message.message_id AS "providerMessageId",
           contact.phone AS "contactPhone"
         FROM public.messages AS message
         INNER JOIN public.conversations AS conversation
           ON conversation.id = message.conversation_id
         LEFT JOIN public.contacts AS contact
           ON contact.id = conversation.contact_id
          AND contact.account_id = conversation.account_id
         WHERE message.id = $1
           AND conversation.account_id = $2
         LIMIT 2`,
        [messageId, context.accountId]
      );

      if (query.rows.length === 0) throw new AppError('not_found');
      if (query.rows.length !== 1) throw new AppError('conflict');

      const row = query.rows[0];
      return {
        providerMessageId: optionalDatabaseText(row.providerMessageId),
        contactPhone: optionalDatabaseText(row.contactPhone),
      };
    });

    if (!result.ok) throw result.error;
    return result.data;
  }

  return { getTarget };
}
