import 'server-only';

import type { QueryResultRow } from 'pg';
import type { DealStatus, PipelineBoardDeal } from '../../types';
import type { AccountGuardDependencies } from '../auth/postgres-account-guard';
import { createDefaultPostgresAccountGuards } from '../auth/postgres-account-guard';
import { AppError } from '../db/errors';
import { withTransaction } from '../db/postgres-client';

interface PipelineDealListRow extends QueryResultRow {
  id: string | null;
  user_id: string | null;
  account_id: string | null;
  pipeline_id: string | null;
  pipeline_account_id: string | null;
  stage_id: string | null;
  stage_pipeline_id: string | null;
  contact_id: string | null;
  contact_row_id: string | null;
  contact_account_id: string | null;
  contact_phone: string | null;
  contact_name: string | null;
  conversation_id: string | null;
  assigned_to: string | null;
  assignee_row_id: string | null;
  assignee_account_id: string | null;
  assignee_full_name: string | null;
  title: string | null;
  value: string | null;
  currency: string | null;
  notes: string | null;
  expected_close_date: string | null;
  status: string | null;
  created_at: Date | string | null;
  updated_at: Date | string | null;
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

function optionalUuid(value: unknown): string | undefined {
  if (value === null || value === undefined) return undefined;
  return uuidString(value);
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

function optionalString(value: unknown): string | undefined {
  if (value === null || value === undefined) return undefined;
  return requiredString(value);
}

function numericValue(value: unknown): number {
  if (
    typeof value !== 'string' ||
    !/^-?(?:0|[1-9]\d{0,9})(?:\.\d{1,2})?$/.test(value)
  ) {
    throw new AppError('db_error');
  }
  const number = Number(value);
  if (!Number.isFinite(number)) throw new AppError('db_error');
  return number;
}

function optionalDealStatus(value: unknown): DealStatus | undefined {
  if (value === null || value === undefined) return undefined;
  if (value === 'open' || value === 'won' || value === 'lost') return value;
  throw new AppError('db_error');
}

function optionalDateString(value: unknown): string | undefined {
  if (value === null || value === undefined) return undefined;
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new AppError('db_error');
  }

  const [year, month, day] = value.split('-').map(Number);
  const date = new Date(0);
  date.setUTCHours(0, 0, 0, 0);
  date.setUTCFullYear(year, month - 1, day);
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    throw new AppError('db_error');
  }
  return value;
}

function timestampString(value: Date | string): string {
  const date = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(date.getTime())) throw new AppError('db_error');
  return date.toISOString();
}

function toPipelineDeal(
  row: PipelineDealListRow,
  accountId: string,
  pipelineId: string
): PipelineBoardDeal {
  const id = uuidString(row.id);
  const userId = uuidString(row.user_id);
  const rowAccountId = uuidString(row.account_id);
  const rowPipelineId = uuidString(row.pipeline_id);
  const pipelineAccountId = uuidString(row.pipeline_account_id);
  const stageId = uuidString(row.stage_id);
  const stagePipelineId = uuidString(row.stage_pipeline_id);

  if (
    rowAccountId !== accountId.toLowerCase() ||
    rowPipelineId !== pipelineId.toLowerCase() ||
    pipelineAccountId !== rowAccountId ||
    stagePipelineId !== rowPipelineId
  ) {
    throw new AppError('db_error');
  }

  const contactId = optionalUuid(row.contact_id);
  const contactRowId = optionalUuid(row.contact_row_id);
  let contact: PipelineBoardDeal['contact'];
  if (contactRowId !== undefined) {
    const contactAccountId = uuidString(row.contact_account_id);
    if (
      contactId === undefined ||
      contactRowId !== contactId ||
      contactAccountId !== rowAccountId
    ) {
      throw new AppError('db_error');
    }
    contact = {
      id: contactRowId,
      phone: requiredString(row.contact_phone),
      ...(row.contact_name !== null && {
        name: requiredString(row.contact_name),
      }),
    };
  } else if (
    row.contact_account_id !== null ||
    row.contact_phone !== null ||
    row.contact_name !== null
  ) {
    throw new AppError('db_error');
  }

  const assignedTo = optionalUuid(row.assigned_to);
  const assigneeId = optionalUuid(row.assignee_row_id);
  let assignee: PipelineBoardDeal['assignee'];
  if (assigneeId !== undefined) {
    const assigneeAccountId = uuidString(row.assignee_account_id);
    if (
      assignedTo === undefined ||
      assigneeId !== assignedTo ||
      assigneeAccountId !== rowAccountId
    ) {
      throw new AppError('db_error');
    }
    assignee = {
      id: assigneeId,
      full_name: requiredString(row.assignee_full_name),
    };
  } else if (
    row.assignee_account_id !== null ||
    row.assignee_full_name !== null
  ) {
    throw new AppError('db_error');
  }

  const conversationId = optionalUuid(row.conversation_id);
  const currency = optionalString(row.currency);
  const notes = optionalString(row.notes);
  const expectedCloseDate = optionalDateString(row.expected_close_date);
  const status = optionalDealStatus(row.status);

  return {
    id,
    user_id: userId,
    pipeline_id: rowPipelineId,
    stage_id: stageId,
    contact_id: contactId ?? null,
    title: requiredString(row.title),
    value: numericValue(row.value),
    created_at:
      row.created_at === null ? null : timestampString(row.created_at),
    updated_at:
      row.updated_at === null ? null : timestampString(row.updated_at),
    ...(conversationId !== undefined && { conversation_id: conversationId }),
    ...(assignedTo !== undefined && { assigned_to: assignedTo }),
    ...(currency !== undefined && { currency }),
    ...(notes !== undefined && { notes }),
    ...(expectedCloseDate !== undefined && {
      expected_close_date: expectedCloseDate,
    }),
    ...(status !== undefined && { status }),
    ...(contact !== undefined && { contact }),
    ...(assignee !== undefined && { assignee }),
  };
}

/** List deals on a pipeline board newest first with safe relation summaries. */
export function createPostgresPipelineDealListRepository(
  getVerifiedSession: AccountGuardDependencies['getVerifiedSession']
): { listForPipeline: (pipelineId: string) => Promise<PipelineBoardDeal[]> } {
  const guards = createDefaultPostgresAccountGuards(getVerifiedSession);

  async function listForPipeline(
    pipelineIdInput: string
  ): Promise<PipelineBoardDeal[]> {
    const context = await guards.requireAccount();
    const pipelineId = requestedUuid(pipelineIdInput);

    const result = await withTransaction(async (transaction) => {
      // Existing RLS policies resolve auth.uid() from this transaction-local GUC.
      await transaction.query(
        "SELECT set_config('request.jwt.claim.sub', $1, true)",
        [context.userId]
      );

      const query = await transaction.query<PipelineDealListRow>(
        `SELECT
           d.id::text AS id,
           d.user_id::text AS user_id,
           d.account_id::text AS account_id,
           d.pipeline_id::text AS pipeline_id,
           p.account_id::text AS pipeline_account_id,
           d.stage_id::text AS stage_id,
           ps.pipeline_id::text AS stage_pipeline_id,
           d.contact_id::text AS contact_id,
           c.id::text AS contact_row_id,
           c.account_id::text AS contact_account_id,
           c.phone AS contact_phone,
           c.name AS contact_name,
           d.conversation_id::text AS conversation_id,
           d.assigned_to::text AS assigned_to,
           assignee.id::text AS assignee_row_id,
           assignee.account_id::text AS assignee_account_id,
           assignee.full_name AS assignee_full_name,
           d.title,
           d.value::text AS value,
           d.currency,
           d.notes,
           to_char(d.expected_close_date, 'YYYY-MM-DD') AS expected_close_date,
           d.status,
           d.created_at,
           d.updated_at
         FROM public.deals AS d
         INNER JOIN public.pipelines AS p
           ON p.id = d.pipeline_id
          AND p.account_id = d.account_id
         INNER JOIN public.pipeline_stages AS ps
           ON ps.id = d.stage_id
          AND ps.pipeline_id = d.pipeline_id
         LEFT JOIN public.contacts AS c
           ON c.id = d.contact_id
          AND c.account_id = d.account_id
         LEFT JOIN public.profiles AS assignee
           ON assignee.id = d.assigned_to
          AND assignee.account_id = d.account_id
         WHERE d.account_id = $1
           AND d.pipeline_id = $2
         ORDER BY d.created_at DESC NULLS LAST, d.id DESC`,
        [context.accountId, pipelineId]
      );

      return query.rows.map((row) =>
        toPipelineDeal(row, context.accountId, pipelineId)
      );
    });

    if (!result.ok) throw result.error;
    return result.data;
  }

  return { listForPipeline };
}
