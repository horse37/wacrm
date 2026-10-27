import 'server-only';

import type { QueryResultRow } from 'pg';
import type { Deal, DealStatus } from '../../types';
import type { AccountGuardDependencies } from '../auth/postgres-account-guard';
import { createDefaultPostgresAccountGuards } from '../auth/postgres-account-guard';
import { AppError } from '../db/errors';
import { withTransaction } from '../db/postgres-client';

interface ContactDealListRow extends QueryResultRow {
  id: string | null;
  user_id: string | null;
  account_id: string | null;
  contact_id: string | null;
  contact_account_id: string | null;
  pipeline_id: string | null;
  pipeline_account_id: string | null;
  stage_id: string | null;
  stage_pipeline_id: string | null;
  conversation_id: string | null;
  assigned_to: string | null;
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

function timestampString(value: Date | string | null): string {
  const date = value instanceof Date ? value : new Date(value ?? Number.NaN);
  if (!Number.isFinite(date.getTime())) throw new AppError('db_error');
  return date.toISOString();
}

function optionalDateString(value: string | null): string | undefined {
  if (value === null) return undefined;
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

function numericValue(value: unknown): number {
  // PostgreSQL NUMERIC is returned as decimal text by node-postgres. NUMERIC(12,2)
  // is within the safe integer range in cents before conversion to JS number.
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

function toDeal(
  row: ContactDealListRow,
  accountId: string,
  contactId: string
): Deal {
  const id = uuidString(row.id);
  const userId = uuidString(row.user_id);
  const rowAccountId = uuidString(row.account_id);
  const rowContactId = uuidString(row.contact_id);
  const contactAccountId = uuidString(row.contact_account_id);
  const pipelineId = uuidString(row.pipeline_id);
  const pipelineAccountId = uuidString(row.pipeline_account_id);
  const stageId = uuidString(row.stage_id);
  const stagePipelineId = uuidString(row.stage_pipeline_id);

  if (
    rowAccountId !== accountId.toLowerCase() ||
    rowContactId !== contactId.toLowerCase() ||
    contactAccountId !== rowAccountId ||
    pipelineAccountId !== rowAccountId ||
    stagePipelineId !== pipelineId
  ) {
    throw new AppError('db_error');
  }

  const conversationId = optionalString(row.conversation_id);
  const assignedTo = optionalString(row.assigned_to);
  const currency = optionalString(row.currency);
  const notes = optionalString(row.notes);
  const expectedCloseDate = optionalDateString(row.expected_close_date);
  const status = optionalDealStatus(row.status);

  return {
    id,
    user_id: userId,
    pipeline_id: pipelineId,
    stage_id: stageId,
    contact_id: rowContactId,
    title: requiredString(row.title),
    value: numericValue(row.value),
    created_at: timestampString(row.created_at),
    ...(conversationId !== undefined && { conversation_id: conversationId }),
    ...(assignedTo !== undefined && { assigned_to: assignedTo }),
    ...(currency !== undefined && { currency }),
    ...(notes !== undefined && { notes }),
    ...(expectedCloseDate !== undefined && {
      expected_close_date: expectedCloseDate,
    }),
    ...(status !== undefined && { status }),
    ...(row.updated_at !== null && {
      updated_at: timestampString(row.updated_at),
    }),
  };
}

/** Read a contact's account-scoped deals newest first. */
export function createPostgresContactDealListRepository(
  getVerifiedSession: AccountGuardDependencies['getVerifiedSession']
): { listForContact: (contactId: string) => Promise<Deal[]> } {
  const guards = createDefaultPostgresAccountGuards(getVerifiedSession);

  async function listForContact(contactIdInput: string): Promise<Deal[]> {
    const context = await guards.requireAccount();
    const contactId = requestedUuid(contactIdInput);

    const result = await withTransaction(async (transaction) => {
      // Existing RLS policies resolve auth.uid() from this transaction-local GUC.
      await transaction.query(
        "SELECT set_config('request.jwt.claim.sub', $1, true)",
        [context.userId]
      );

      const query = await transaction.query<ContactDealListRow>(
        `SELECT
           d.id::text AS id,
           d.user_id::text AS user_id,
           d.account_id::text AS account_id,
           d.contact_id::text AS contact_id,
           c.account_id::text AS contact_account_id,
           d.pipeline_id::text AS pipeline_id,
           p.account_id::text AS pipeline_account_id,
           d.stage_id::text AS stage_id,
           ps.pipeline_id::text AS stage_pipeline_id,
           d.conversation_id::text AS conversation_id,
           d.assigned_to::text AS assigned_to,
           d.title,
           d.value::text AS value,
           d.currency,
           d.notes,
           to_char(d.expected_close_date, 'YYYY-MM-DD') AS expected_close_date,
           d.status,
           d.created_at,
           d.updated_at
         FROM public.deals AS d
         INNER JOIN public.contacts AS c
           ON c.id = d.contact_id
          AND c.account_id = d.account_id
         INNER JOIN public.pipelines AS p
           ON p.id = d.pipeline_id
          AND p.account_id = d.account_id
         INNER JOIN public.pipeline_stages AS ps
           ON ps.id = d.stage_id
          AND ps.pipeline_id = d.pipeline_id
         WHERE d.account_id = $1
           AND d.contact_id = $2
         ORDER BY d.created_at DESC NULLS LAST, d.id DESC`,
        [context.accountId, contactId]
      );

      return query.rows.map((row) => toDeal(row, context.accountId, contactId));
    });

    if (!result.ok) throw result.error;
    return result.data;
  }

  return { listForContact };
}
