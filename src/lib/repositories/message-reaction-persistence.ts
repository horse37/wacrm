import 'server-only';

import type { QueryResultRow } from 'pg';
import type { AccountGuardDependencies } from '../auth/postgres-account-guard';
import { createDefaultPostgresAccountGuards } from '../auth/postgres-account-guard';
import { AppError } from '../db/errors';
import { withTransaction } from '../db/postgres-client';

interface ReactionTargetRow extends QueryResultRow {
  conversationId: unknown;
  providerMessageId: unknown;
}

interface MessageReactionRow extends QueryResultRow {
  id: unknown;
}

const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function requestedUuid(value: unknown): string {
  if (typeof value !== 'string' || !uuidPattern.test(value)) {
    throw new AppError('bad_request');
  }
  return value.toLowerCase();
}

function returnedUuid(value: unknown): string {
  if (typeof value !== 'string' || !uuidPattern.test(value)) {
    throw new AppError('db_error');
  }
  return value.toLowerCase();
}

/** Persist one agent reaction after its provider operation has succeeded. */
export function createPostgresMessageReactionPersistenceRepository(
  getVerifiedSession: AccountGuardDependencies['getVerifiedSession']
): {
  saveAgentReaction: (messageId: string, emoji: string) => Promise<void>;
} {
  const guards = createDefaultPostgresAccountGuards(getVerifiedSession);

  async function saveAgentReaction(
    messageIdInput: string,
    emojiInput: string
  ): Promise<void> {
    const context = await guards.requireRole('agent');
    const messageId = requestedUuid(messageIdInput);
    if (typeof emojiInput !== 'string') throw new AppError('bad_request');

    const result = await withTransaction(async (transaction) => {
      // Existing RLS policies resolve auth.uid() from this transaction-local GUC.
      await transaction.query(
        "SELECT set_config('request.jwt.claim.sub', $1, true)",
        [context.userId]
      );

      const target = await transaction.query<ReactionTargetRow>(
        `SELECT
           conversation.id::text AS "conversationId",
           message.message_id AS "providerMessageId"
         FROM public.messages AS message
         INNER JOIN public.conversations AS conversation
           ON conversation.id = message.conversation_id
         WHERE message.id = $1
           AND conversation.account_id = $2
         LIMIT 2`,
        [messageId, context.accountId]
      );

      if (target.rows.length === 0) throw new AppError('not_found');
      if (target.rows.length !== 1) throw new AppError('conflict');

      const row = target.rows[0];
      const conversationId = returnedUuid(row.conversationId);
      if (
        typeof row.providerMessageId !== 'string' ||
        row.providerMessageId.trim().length === 0
      ) {
        throw new AppError('bad_request');
      }

      if (emojiInput === '') {
        const deletion = await transaction.query<MessageReactionRow>(
          `DELETE FROM public.message_reactions AS reaction
           WHERE reaction.message_id = $1
             AND reaction.conversation_id = $2
             AND reaction.actor_type = 'agent'
             AND reaction.actor_id = $3
           RETURNING reaction.id::text AS id`,
          [messageId, conversationId, context.userId]
        );

        if (deletion.rows.length > 1) throw new AppError('conflict');
        if (deletion.rows.length === 1) returnedUuid(deletion.rows[0].id);
        return;
      }

      const upsert = await transaction.query<MessageReactionRow>(
        `INSERT INTO public.message_reactions AS reaction (
           message_id,
           conversation_id,
           actor_type,
           actor_id,
           emoji
         )
         VALUES ($1, $2, 'agent', $3, $4)
         ON CONFLICT (message_id, actor_type, actor_id)
         DO UPDATE SET
           conversation_id = EXCLUDED.conversation_id,
           emoji = EXCLUDED.emoji
         RETURNING reaction.id::text AS id`,
        [messageId, conversationId, context.userId, emojiInput]
      );

      if (upsert.rows.length !== 1) throw new AppError('db_error');
      returnedUuid(upsert.rows[0].id);
    });

    if (!result.ok) throw result.error;
  }

  return { saveAgentReaction };
}
