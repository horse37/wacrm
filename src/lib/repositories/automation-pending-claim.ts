import 'server-only';

import type { QueryResultRow } from 'pg';
import type { AutomationContext } from '../automations/engine';
import { AppError } from '../db/errors';
import { withTransaction } from '../db/postgres-client';

export interface AutomationPendingExecution {
  id: string;
  automation_id: string;
  account_id: string;
  user_id: string;
  contact_id: string | null;
  log_id: string | null;
  parent_step_id: string | null;
  branch: 'yes' | 'no' | null;
  next_step_position: number;
  context: AutomationContext;
}

export interface AutomationPendingClaimWriterContext {
  userId: string;
  accountId: string;
}

interface AutomationPendingExecutionRow extends QueryResultRow {
  id: unknown;
  automation_id: unknown;
  account_id: unknown;
  user_id: unknown;
  contact_id: unknown;
  log_id: unknown;
  parent_step_id: unknown;
  branch: unknown;
  next_step_position: unknown;
  context: unknown;
}

const MAX_CLAIM_LIMIT = 50;

function uuidString(value: unknown): string {
  if (
    typeof value !== 'string' ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
      value
    )
  ) {
    throw new AppError('db_error');
  }
  return value.toLowerCase();
}

function isUuid(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
      value
    )
  );
}

function optionalUuidString(value: unknown): string | null {
  return value === null ? null : uuidString(value);
}

function branchValue(value: unknown): 'yes' | 'no' | null {
  if (value === null) return null;
  if (value === 'yes' || value === 'no') return value;
  throw new AppError('db_error');
}

function stepPosition(value: unknown): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) {
    throw new AppError('db_error');
  }
  return value;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (
    typeof value !== 'object' ||
    value === null ||
    Array.isArray(value) ||
    Object.getPrototypeOf(value) !== Object.prototype
  ) {
    return false;
  }
  return true;
}

function automationContext(value: unknown): AutomationContext {
  if (!isPlainObject(value)) throw new AppError('db_error');

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
      throw new AppError('db_error');
    }
  }

  if (
    Object.prototype.hasOwnProperty.call(value, 'vars') &&
    !isPlainObject(value.vars)
  ) {
    throw new AppError('db_error');
  }

  return value as AutomationContext;
}

function toPendingExecution(
  row: AutomationPendingExecutionRow
): AutomationPendingExecution {
  return {
    id: uuidString(row.id),
    automation_id: uuidString(row.automation_id),
    account_id: uuidString(row.account_id),
    user_id: uuidString(row.user_id),
    contact_id: optionalUuidString(row.contact_id),
    log_id: optionalUuidString(row.log_id),
    parent_step_id: optionalUuidString(row.parent_step_id),
    branch: branchValue(row.branch),
    next_step_position: stepPosition(row.next_step_position),
    context: automationContext(row.context),
  };
}

function validateClaimInput(asOf: Date, limit: number): void {
  if (!(asOf instanceof Date) || !Number.isFinite(asOf.getTime())) {
    throw new AppError('bad_request');
  }
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > MAX_CLAIM_LIMIT) {
    throw new AppError('bad_request');
  }
}

function validateWriterContext(
  value: unknown
): AutomationPendingClaimWriterContext {
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

/** Atomically claim due automation wait executions for a future cron consumer. */
export function createPostgresAutomationPendingClaimRepository(): {
  claimDue: (
    writerContext: AutomationPendingClaimWriterContext,
    asOf: Date,
    limit?: number
  ) => Promise<AutomationPendingExecution[]>;
} {
  async function claimDue(
    writerContextInput: AutomationPendingClaimWriterContext,
    asOf: Date,
    limit = MAX_CLAIM_LIMIT
  ): Promise<AutomationPendingExecution[]> {
    const writerContext = validateWriterContext(writerContextInput);
    validateClaimInput(asOf, limit);

    const result = await withTransaction(async (transaction) => {
      await transaction.query(
        "SELECT set_config('request.jwt.claim.sub', $1, true)",
        [writerContext.userId]
      );

      const claimed = await transaction.query<AutomationPendingExecutionRow>(
        `WITH due AS (
           SELECT id
           FROM public.automation_pending_executions
           WHERE account_id = $1
             AND status = 'pending'
             AND run_at <= $2
           ORDER BY run_at ASC, id ASC
           LIMIT $3
           FOR UPDATE SKIP LOCKED
         ), claimed AS (
           UPDATE public.automation_pending_executions AS pending
           SET status = 'running'
           FROM due
           WHERE pending.id = due.id
             AND pending.account_id = $1
             AND pending.status = 'pending'
           RETURNING
             pending.id::text AS id,
             pending.automation_id::text AS automation_id,
             pending.account_id::text AS account_id,
             pending.user_id::text AS user_id,
             pending.contact_id::text AS contact_id,
             pending.log_id::text AS log_id,
             pending.parent_step_id::text AS parent_step_id,
             pending.branch,
             pending.next_step_position,
             pending.context,
             pending.run_at
         )
         SELECT
           id,
           automation_id,
           account_id,
           user_id,
           contact_id,
           log_id,
           parent_step_id,
           branch,
           next_step_position,
           context,
           run_at
         FROM claimed
         ORDER BY run_at ASC, id ASC`,
        [writerContext.accountId, asOf, limit]
      );

      return claimed.rows.map(toPendingExecution);
    });

    if (!result.ok) throw result.error;
    return result.data;
  }

  return { claimDue };
}
