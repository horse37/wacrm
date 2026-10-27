import 'server-only';
import type { QueryResultRow } from 'pg';
import type { AutomationTriggerType } from '../../types';
import { AppError } from '../db/errors';
import { withTransaction } from '../db/postgres-client';
import type { AutomationLogWriterContext } from './automation-log-append';

export interface AutomationLogCreateInput {
  automationId: string;
  contactId: string | null;
  triggerEvent: AutomationTriggerType;
}

interface InsertedAutomationLogRow extends QueryResultRow {
  id: unknown;
}

const automationTriggerTypes: readonly AutomationTriggerType[] = [
  'new_message_received',
  'first_inbound_message',
  'keyword_match',
  'new_contact_created',
  'conversation_assigned',
  'tag_added',
  'time_based',
];

function isUuid(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
      value
    )
  );
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return false;
  }

  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function validateInput(
  writerContext: unknown,
  input: unknown
): {
  automationId: string;
  accountId: string;
  userId: string;
  contactId: string | null;
  triggerEvent: AutomationTriggerType;
} {
  if (!isPlainObject(writerContext) || !isPlainObject(input)) {
    throw new AppError('bad_request');
  }

  const { automationId, contactId, triggerEvent } = input;
  if (
    !isUuid(writerContext.userId) ||
    !isUuid(writerContext.accountId) ||
    !isUuid(automationId) ||
    (contactId !== null && !isUuid(contactId)) ||
    typeof triggerEvent !== 'string' ||
    !automationTriggerTypes.includes(triggerEvent as AutomationTriggerType)
  ) {
    throw new AppError('bad_request');
  }

  return {
    automationId: automationId.toLowerCase(),
    accountId: writerContext.accountId.toLowerCase(),
    userId: writerContext.userId.toLowerCase(),
    contactId: typeof contactId === 'string' ? contactId.toLowerCase() : null,
    triggerEvent: triggerEvent as AutomationTriggerType,
  };
}

function generatedUuid(value: unknown): string {
  if (!isUuid(value)) throw new AppError('db_error');
  return value.toLowerCase();
}

/** Create one initial automation execution log with trusted tenant context. */
export function createPostgresAutomationLogCreateRepository(): {
  create: (
    writerContext: AutomationLogWriterContext,
    input: AutomationLogCreateInput
  ) => Promise<string>;
} {
  async function create(
    writerContext: AutomationLogWriterContext,
    input: AutomationLogCreateInput
  ): Promise<string> {
    const validatedInput = validateInput(writerContext, input);

    const result = await withTransaction(async (transaction) => {
      await transaction.query(
        "SELECT set_config('request.jwt.claim.sub', $1, true)",
        [validatedInput.userId]
      );

      const insertSql = [
        'INSERT INTO public.automation_logs',
        '(automation_id, account_id, user_id, contact_id, trigger_event, steps_executed, status)',
        "VALUES ($1, $2, $3, $4, $5, '[]'::jsonb, 'success')",
        'RETURNING id::text AS id',
      ].join('\n');
      const inserted = await transaction.query<InsertedAutomationLogRow>(
        insertSql,
        [
          validatedInput.automationId,
          validatedInput.accountId,
          validatedInput.userId,
          validatedInput.contactId,
          validatedInput.triggerEvent,
        ]
      );

      if (inserted.rows.length !== 1) throw new AppError('db_error');
      return generatedUuid(inserted.rows[0].id);
    });

    if (!result.ok) throw result.error;
    return result.data;
  }

  return { create };
}
