import 'server-only';

import type {
  AutomationLogStatus,
  AutomationLogStepResult,
  AutomationStepType,
} from '../../types';
import { AppError } from '../db/errors';
import { withTransaction } from '../db/postgres-client';

const automationStepTypes: readonly AutomationStepType[] = [
  'send_message',
  'send_template',
  'add_tag',
  'remove_tag',
  'assign_conversation',
  'update_contact_field',
  'create_deal',
  'wait',
  'condition',
  'send_webhook',
  'close_conversation',
];

const automationLogStatuses: readonly AutomationLogStatus[] = [
  'success',
  'partial',
  'failed',
];

const automationStepResultStatuses = ['success', 'skipped', 'failed'] as const;

export interface AutomationLogWriterContext {
  /** Trusted automation owner loaded by server code, never request input. */
  userId: string;
  /** Tenant copied from the same trusted automation row. */
  accountId: string;
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
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return false;
  }

  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function validateResults(value: unknown): AutomationLogStepResult[] {
  if (!Array.isArray(value)) throw new AppError('bad_request');

  for (let index = 0; index < value.length; index += 1) {
    if (!Object.hasOwn(value, index)) throw new AppError('bad_request');
  }

  return value.map((item) => {
    if (!isPlainObject(item)) throw new AppError('bad_request');

    const { step_id: stepId, step_type: stepType, status, detail } = item;
    if (
      !isUuid(stepId) ||
      typeof stepType !== 'string' ||
      !automationStepTypes.includes(stepType as AutomationStepType) ||
      typeof status !== 'string' ||
      !(automationStepResultStatuses as readonly string[]).includes(status) ||
      (detail !== undefined && typeof detail !== 'string')
    ) {
      throw new AppError('bad_request');
    }

    const result: AutomationLogStepResult = {
      step_id: stepId.toLowerCase(),
      step_type: stepType as AutomationStepType,
      status: status as AutomationLogStepResult['status'],
    };
    if (detail !== undefined) result.detail = detail;
    return result;
  });
}

function validateInput(
  writerContext: unknown,
  logId: unknown,
  results: unknown,
  status: unknown,
  errorMessage: unknown
): {
  userId: string;
  accountId: string;
  logId: string;
  results: AutomationLogStepResult[];
  status: AutomationLogStatus | null;
  errorMessage: string | null;
  replaceErrorMessage: boolean;
} {
  if (!isPlainObject(writerContext)) throw new AppError('bad_request');
  if (!isUuid(writerContext.userId) || !isUuid(writerContext.accountId)) {
    throw new AppError('bad_request');
  }
  if (!isUuid(logId)) throw new AppError('bad_request');

  const validatedStatus = status ?? null;
  if (
    validatedStatus !== null &&
    (typeof validatedStatus !== 'string' ||
      !automationLogStatuses.includes(validatedStatus as AutomationLogStatus))
  ) {
    throw new AppError('bad_request');
  }

  const validatedErrorMessage = errorMessage ?? null;
  if (
    validatedErrorMessage !== null &&
    typeof validatedErrorMessage !== 'string'
  ) {
    throw new AppError('bad_request');
  }

  return {
    userId: writerContext.userId.toLowerCase(),
    accountId: writerContext.accountId.toLowerCase(),
    logId: logId.toLowerCase(),
    results: validateResults(results),
    status: validatedStatus as AutomationLogStatus | null,
    errorMessage:
      typeof validatedErrorMessage === 'string' &&
      validatedErrorMessage.length > 0
        ? validatedErrorMessage
        : null,
    replaceErrorMessage:
      typeof validatedErrorMessage === 'string' &&
      validatedErrorMessage.length > 0,
  };
}

/**
 * Append validated step summaries to one execution log without racing concurrent updates.
 * The writer context must come from a trusted automation row, never request fields.
 */
export function createPostgresAutomationLogAppendRepository(): {
  append: (
    writerContext: AutomationLogWriterContext,
    logId: string,
    results: readonly AutomationLogStepResult[],
    status?: AutomationLogStatus | null,
    errorMessage?: string | null
  ) => Promise<boolean>;
} {
  async function append(
    writerContext: AutomationLogWriterContext,
    logId: string,
    results: readonly AutomationLogStepResult[],
    status?: AutomationLogStatus | null,
    errorMessage?: string | null
  ): Promise<boolean> {
    const validated = validateInput(
      writerContext,
      logId,
      results,
      status,
      errorMessage
    );

    const result = await withTransaction(async (transaction) => {
      await transaction.query(
        "SELECT set_config('request.jwt.claim.sub', $1, true)",
        [validated.userId]
      );

      const updated = await transaction.query(
        `UPDATE public.automation_logs
         SET steps_executed = steps_executed || $4::jsonb,
             status = COALESCE($5::text, status),
             error_message = CASE
               WHEN $6::boolean THEN $7::text
               ELSE error_message
             END
         WHERE id = $1
           AND account_id = $2
           AND user_id = $3
           AND jsonb_typeof(steps_executed) = 'array'`,
        [
          validated.logId,
          validated.accountId,
          validated.userId,
          JSON.stringify(validated.results),
          validated.status,
          validated.replaceErrorMessage,
          validated.errorMessage,
        ]
      );

      if (updated.rowCount === 0) return false;
      if (updated.rowCount === 1) return true;
      throw new AppError('db_error');
    });

    if (!result.ok) throw result.error;
    return result.data;
  }

  return { append };
}
