import 'server-only';

import type { QueryResultRow } from 'pg';
import type { AutomationLogStatus } from '../../types';
import type { AccountGuardDependencies } from '../auth/postgres-account-guard';
import { createDefaultPostgresAccountGuards } from '../auth/postgres-account-guard';
import { AppError } from '../db/errors';
import { withTransaction } from '../db/postgres-client';

export interface AutomationLogParent {
  id: string;
  name: string;
}

export interface AutomationLogStepSummary {
  step_type: string;
  status: 'success' | 'skipped' | 'failed';
  detail?: string;
}

export interface AutomationLogListItem {
  id: string;
  trigger_event: string;
  steps_executed: AutomationLogStepSummary[];
  status: AutomationLogStatus;
  error_message: string | null;
  created_at: string;
  contact: { name: string | null; phone: string | null } | null;
}

export interface AutomationLogsList {
  automation: AutomationLogParent;
  logs: AutomationLogListItem[];
}

interface AutomationParentRow extends QueryResultRow {
  id: string | null;
  name: string | null;
  author_user_id: string | null;
}

interface AutomationLogRow extends QueryResultRow {
  id: string | null;
  trigger_event: string | null;
  steps_executed: unknown;
  status: string | null;
  error_message: string | null;
  created_at: string | null;
  contact_id: string | null;
  contact_name: string | null;
  contact_phone: string | null;
}

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

function requestedUuid(value: unknown): string {
  try {
    return uuidString(value);
  } catch {
    throw new AppError('bad_request');
  }
}

function requiredString(value: unknown): string {
  if (typeof value !== 'string') throw new AppError('db_error');
  return value;
}

function optionalString(value: unknown): string | null {
  if (value === null) return null;
  return requiredString(value);
}

function timestampString(value: unknown): string {
  if (typeof value !== 'string') throw new AppError('db_error');
  const date = new Date(value);
  if (!Number.isFinite(date.getTime()) || date.toISOString() !== value) {
    throw new AppError('db_error');
  }
  return value;
}

function logStatus(value: unknown): AutomationLogStatus {
  if (value === 'success' || value === 'partial' || value === 'failed') {
    return value;
  }
  throw new AppError('db_error');
}

function stepSummaries(value: unknown): AutomationLogStepSummary[] {
  if (!Array.isArray(value)) throw new AppError('db_error');

  return value.map((step) => {
    if (typeof step !== 'object' || step === null || Array.isArray(step)) {
      throw new AppError('db_error');
    }

    const row = step as Record<string, unknown>;
    const stepType = requiredString(row.step_type);
    if (stepType.length === 0) throw new AppError('db_error');
    const status = row.status;
    if (status !== 'success' && status !== 'skipped' && status !== 'failed') {
      throw new AppError('db_error');
    }

    const summary: AutomationLogStepSummary = {
      step_type: stepType,
      status,
    };
    if (row.detail !== undefined) summary.detail = requiredString(row.detail);
    return summary;
  });
}

function toAutomationLog(row: AutomationLogRow): AutomationLogListItem {
  const contactId = row.contact_id === null ? null : uuidString(row.contact_id);
  const contact =
    contactId === null
      ? null
      : {
          name: optionalString(row.contact_name),
          phone: optionalString(row.contact_phone),
        };

  return {
    id: uuidString(row.id),
    trigger_event: requiredString(row.trigger_event),
    steps_executed: stepSummaries(row.steps_executed),
    status: logStatus(row.status),
    error_message: optionalString(row.error_message),
    created_at: timestampString(row.created_at),
    contact,
  };
}

/** Read the latest execution history for one automation in the verified account. */
export function createPostgresAutomationLogsRepository(
  getVerifiedSession: AccountGuardDependencies['getVerifiedSession']
): {
  listForAutomation: (automationId: string) => Promise<AutomationLogsList>;
} {
  const guards = createDefaultPostgresAccountGuards(getVerifiedSession);

  async function listForAutomation(
    automationIdInput: string
  ): Promise<AutomationLogsList> {
    const context = await guards.requireAccount();
    const automationId = requestedUuid(automationIdInput);

    const result = await withTransaction(async (transaction) => {
      // Existing RLS policies resolve auth.uid() from this transaction-local GUC.
      await transaction.query(
        "SELECT set_config('request.jwt.claim.sub', $1, true)",
        [context.userId]
      );

      const parentQuery = await transaction.query<AutomationParentRow>(
        `SELECT
           a.id::text AS id,
           a.name,
           a.user_id::text AS author_user_id
         FROM public.automations AS a
         WHERE a.account_id = $1
           AND a.id = $2
         LIMIT 2`,
        [context.accountId, automationId]
      );

      if (parentQuery.rows.length === 0) throw new AppError('not_found');
      if (parentQuery.rows.length !== 1) throw new AppError('conflict');

      const parentRow = parentQuery.rows[0];
      const parentId = uuidString(parentRow.id);
      if (parentId !== automationId) throw new AppError('db_error');
      const automation = {
        id: parentId,
        name: requiredString(parentRow.name),
      };
      const authorUserId = uuidString(parentRow.author_user_id);

      const logQuery = await transaction.query<AutomationLogRow>(
        `SELECT
           l.id::text AS id,
           l.trigger_event,
           l.steps_executed,
           l.status,
           l.error_message,
           to_char(
             l.created_at AT TIME ZONE 'UTC',
             'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'
           ) AS created_at,
           c.id::text AS contact_id,
           c.name AS contact_name,
           c.phone AS contact_phone
         FROM public.automation_logs AS l
         LEFT JOIN public.contacts AS c
           ON c.id = l.contact_id
          AND c.account_id = l.account_id
         WHERE l.account_id = $1
           AND l.automation_id = $2
           AND l.user_id = $3
         ORDER BY l.created_at DESC, l.id DESC
         LIMIT $4`,
        [context.accountId, automationId, authorUserId, 100]
      );

      return {
        automation,
        logs: logQuery.rows.map(toAutomationLog),
      };
    });

    if (!result.ok) throw result.error;
    return result.data;
  }

  return { listForAutomation };
}
