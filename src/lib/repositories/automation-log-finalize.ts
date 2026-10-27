import 'server-only';

import type { AutomationLogStatus } from '../../types';
import { AppError } from '../db/errors';
import { withTransaction } from '../db/postgres-client';
import type { AutomationLogWriterContext } from './automation-log-append';

const automationLogStatuses: readonly AutomationLogStatus[] = [
  'success',
  'partial',
  'failed',
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
  logId: unknown,
  status: unknown,
  errorMessage: unknown
): {
  userId: string;
  accountId: string;
  logId: string;
  status: AutomationLogStatus;
  errorMessage: string | null;
} {
  if (
    !isPlainObject(writerContext) ||
    !isUuid(writerContext.userId) ||
    !isUuid(writerContext.accountId)
  ) {
    throw new AppError('bad_request');
  }
  if (!isUuid(logId)) throw new AppError('bad_request');
  if (
    typeof status !== 'string' ||
    !automationLogStatuses.includes(status as AutomationLogStatus)
  ) {
    throw new AppError('bad_request');
  }
  if (errorMessage !== null && typeof errorMessage !== 'string') {
    throw new AppError('bad_request');
  }

  return {
    userId: writerContext.userId.toLowerCase(),
    accountId: writerContext.accountId.toLowerCase(),
    logId: logId.toLowerCase(),
    status: status as AutomationLogStatus,
    errorMessage: errorMessage as string | null,
  };
}

/** Persist an automation execution's final status and explicitly set or clear its error. */
export function createPostgresAutomationLogFinalizeRepository(): {
  finalize: (
    writerContext: AutomationLogWriterContext,
    logId: string,
    status: AutomationLogStatus,
    errorMessage: string | null
  ) => Promise<boolean>;
} {
  async function finalize(
    writerContext: AutomationLogWriterContext,
    logId: string,
    status: AutomationLogStatus,
    errorMessage: string | null
  ): Promise<boolean> {
    const validated = validateInput(writerContext, logId, status, errorMessage);

    const result = await withTransaction(async (transaction) => {
      await transaction.query(
        "SELECT set_config('request.jwt.claim.sub', $1, true)",
        [validated.userId]
      );

      const updated = await transaction.query(
        `UPDATE public.automation_logs
         SET status = $4,
             error_message = $5
         WHERE id = $1
           AND account_id = $2
           AND user_id = $3`,
        [
          validated.logId,
          validated.accountId,
          validated.userId,
          validated.status,
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

  return { finalize };
}
