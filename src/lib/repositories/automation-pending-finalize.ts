import 'server-only';

import { AppError } from '../db/errors';
import { withTransaction } from '../db/postgres-client';

export type AutomationPendingTerminalStatus = 'done' | 'failed';

export interface AutomationPendingFinalizeWriterContext {
  userId: string;
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

function validateInput(
  writerContext: unknown,
  id: unknown,
  status: unknown
): {
  userId: string;
  accountId: string;
  id: string;
  status: AutomationPendingTerminalStatus;
} {
  if (
    !isPlainObject(writerContext) ||
    !isUuid(writerContext.userId) ||
    !isUuid(writerContext.accountId)
  ) {
    throw new AppError('bad_request');
  }
  if (!isUuid(id)) throw new AppError('bad_request');
  if (status !== 'done' && status !== 'failed') {
    throw new AppError('bad_request');
  }

  return {
    userId: writerContext.userId.toLowerCase(),
    accountId: writerContext.accountId.toLowerCase(),
    id: id.toLowerCase(),
    status,
  };
}

/** Finalize one claimed wait execution for its trusted tenant and owner only. */
export function createPostgresAutomationPendingFinalizeRepository(): {
  finalize: (
    writerContext: AutomationPendingFinalizeWriterContext,
    id: string,
    status: AutomationPendingTerminalStatus
  ) => Promise<boolean>;
} {
  async function finalize(
    writerContext: AutomationPendingFinalizeWriterContext,
    executionId: string,
    terminalStatus: AutomationPendingTerminalStatus
  ): Promise<boolean> {
    const validated = validateInput(writerContext, executionId, terminalStatus);

    const result = await withTransaction(async (transaction) => {
      await transaction.query(
        "SELECT set_config('request.jwt.claim.sub', $1, true)",
        [validated.userId]
      );

      const updated = await transaction.query(
        `UPDATE public.automation_pending_executions
         SET status = $4
         WHERE id = $1
           AND account_id = $2
           AND user_id = $3
           AND status = 'running'`,
        [validated.id, validated.accountId, validated.userId, validated.status]
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
