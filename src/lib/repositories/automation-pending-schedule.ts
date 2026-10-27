import 'server-only';

import type { QueryResultRow } from 'pg';
import type { AutomationContext } from '../automations/engine';
import { AppError } from '../db/errors';
import { withTransaction } from '../db/postgres-client';

export interface AutomationPendingScheduleInput {
  automationId: string;
  contactId: string | null;
  logId: string | null;
  parentStepId: string | null;
  branch: 'yes' | 'no' | null;
  nextStepPosition: number;
  context?: AutomationContext;
  runAt: Date | string;
}

export interface AutomationPendingScheduleWriterContext {
  userId: string;
  accountId: string;
}

interface InsertedPendingExecutionRow extends QueryResultRow {
  id: unknown;
}

function isUuid(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
      value
    )
  );
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return (
    typeof value === 'object' &&
    value !== null &&
    !Array.isArray(value) &&
    Object.getPrototypeOf(value) === Object.prototype
  );
}

function validateContext(value: unknown): void {
  if (!isPlainObject(value)) throw new AppError('bad_request');

  for (const key of [
    'message_text',
    'conversation_id',
    'tag_id',
    'agent_id',
  ] as const) {
    if (
      Object.prototype.hasOwnProperty.call(value, key) &&
      typeof value[key] !== 'string'
    ) {
      throw new AppError('bad_request');
    }
  }

  if (
    Object.prototype.hasOwnProperty.call(value, 'vars') &&
    !isPlainObject(value.vars)
  ) {
    throw new AppError('bad_request');
  }
}

function validateWriterContext(
  value: unknown
): AutomationPendingScheduleWriterContext {
  if (
    !isPlainObject(value) ||
    !isUuid(value.userId) ||
    !isUuid(value.accountId)
  ) {
    throw new AppError('bad_request');
  }

  return {
    userId: value.userId.toLowerCase(),
    accountId: value.accountId.toLowerCase(),
  };
}

function validatedRunAt(value: Date | string): Date {
  const runAt =
    value instanceof Date
      ? new Date(value.getTime())
      : typeof value === 'string'
        ? new Date(value)
        : null;
  if (!runAt || !Number.isFinite(runAt.getTime())) {
    throw new AppError('bad_request');
  }
  return runAt;
}

function validateInput(input: AutomationPendingScheduleInput): {
  context: AutomationContext;
  runAt: Date;
} {
  if (!isPlainObject(input)) throw new AppError('bad_request');

  if (
    !isUuid(input.automationId) ||
    (input.contactId !== null && !isUuid(input.contactId)) ||
    (input.logId !== null && !isUuid(input.logId)) ||
    (input.parentStepId !== null && !isUuid(input.parentStepId)) ||
    (input.branch !== null &&
      input.branch !== 'yes' &&
      input.branch !== 'no') ||
    !Number.isSafeInteger(input.nextStepPosition) ||
    input.nextStepPosition < 0
  ) {
    throw new AppError('bad_request');
  }

  const context = input.context ?? {};
  validateContext(context);

  return { context, runAt: validatedRunAt(input.runAt) };
}

function generatedUuid(value: unknown): string {
  if (!isUuid(value)) throw new AppError('db_error');
  return value.toLowerCase();
}

/** Persist a pending automation wait without coupling the engine to PostgreSQL. */
export function createPostgresAutomationPendingScheduleRepository(): {
  schedule: (
    writerContext: AutomationPendingScheduleWriterContext,
    input: AutomationPendingScheduleInput
  ) => Promise<string>;
} {
  async function schedule(
    writerContextInput: AutomationPendingScheduleWriterContext,
    input: AutomationPendingScheduleInput
  ): Promise<string> {
    const writerContext = validateWriterContext(writerContextInput);
    const { context, runAt } = validateInput(input);

    const result = await withTransaction(async (transaction) => {
      await transaction.query(
        "SELECT set_config('request.jwt.claim.sub', $1, true)",
        [writerContext.userId]
      );

      const inserted = await transaction.query<InsertedPendingExecutionRow>(
        `INSERT INTO public.automation_pending_executions (
           automation_id,
           account_id,
           user_id,
           contact_id,
           log_id,
           parent_step_id,
           branch,
           next_step_position,
           context,
           run_at,
           status
         ) VALUES (
           $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, 'pending'
         )
         RETURNING id::text AS id`,
        [
          input.automationId,
          writerContext.accountId,
          writerContext.userId,
          input.contactId,
          input.logId,
          input.parentStepId,
          input.branch,
          input.nextStepPosition,
          context,
          runAt,
        ]
      );

      if (inserted.rows.length !== 1) throw new AppError('db_error');
      return generatedUuid(inserted.rows[0].id);
    });

    if (!result.ok) throw result.error;
    return result.data;
  }

  return { schedule };
}
