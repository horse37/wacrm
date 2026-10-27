import 'server-only';

import type { QueryResultRow } from 'pg';
import { CURRENCIES } from '../currency';
import type { AccountGuardDependencies } from '../auth/postgres-account-guard';
import { createDefaultPostgresAccountGuards } from '../auth/postgres-account-guard';
import { AppError } from '../db/errors';
import { withTransaction } from '../db/postgres-client';

export interface CreatePipelineDealInput {
  title: string;
  value: number;
  currency: string;
  pipelineId: string;
  stageId: string;
  contactId: string;
  assignedTo?: string | null;
  notes?: string | null;
  expectedCloseDate?: string | null;
}

interface NormalizedCreatePipelineDealInput {
  title: string;
  value: number;
  currency: string;
  pipelineId: string;
  stageId: string;
  contactId: string;
  assignedTo: string | null;
  notes: string | null;
  expectedCloseDate: string | null;
}

interface CreatedDealRow extends QueryResultRow {
  id: string;
}

const currencyCodes = new Set(CURRENCIES.map(({ code }) => code));

function requestedUuid(value: unknown): string {
  if (
    typeof value !== 'string' ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
      value
    )
  ) {
    throw new AppError('bad_request');
  }
  return value.toLowerCase();
}

function optionalUuid(value: unknown): string | null {
  if (value === undefined || value === null) return null;
  return requestedUuid(value);
}

function requestedDate(value: unknown): string | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== 'string') throw new AppError('bad_request');

  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) throw new AppError('bad_request');
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (year < 1 || month < 1 || month > 12) throw new AppError('bad_request');

  const leapYear = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const daysInMonth = [
    31,
    leapYear ? 29 : 28,
    31,
    30,
    31,
    30,
    31,
    31,
    30,
    31,
    30,
    31,
  ];
  if (day < 1 || day > daysInMonth[month - 1]) {
    throw new AppError('bad_request');
  }
  return value;
}

function normalizeInput(input: unknown): NormalizedCreatePipelineDealInput {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) {
    throw new AppError('bad_request');
  }

  const record = input as Record<string, unknown>;
  if (typeof record.title !== 'string' || record.title.trim().length === 0) {
    throw new AppError('bad_request');
  }
  if (
    typeof record.value !== 'number' ||
    !Number.isFinite(record.value) ||
    Math.abs(record.value) > 9_999_999_999.99
  ) {
    throw new AppError('bad_request');
  }
  if (typeof record.currency !== 'string') throw new AppError('bad_request');
  const currency = record.currency.trim().toUpperCase();
  if (!currencyCodes.has(currency)) throw new AppError('bad_request');

  let notes: string | null;
  if (record.notes === undefined || record.notes === null) {
    notes = null;
  } else if (typeof record.notes === 'string') {
    notes = record.notes.trim() || null;
  } else {
    throw new AppError('bad_request');
  }

  return {
    title: record.title.trim(),
    value: record.value,
    currency,
    pipelineId: requestedUuid(record.pipelineId),
    stageId: requestedUuid(record.stageId),
    contactId: requestedUuid(record.contactId),
    assignedTo: optionalUuid(record.assignedTo),
    notes,
    expectedCloseDate: requestedDate(record.expectedCloseDate),
  };
}

function returnedUuid(value: unknown): string {
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

/** Create one open deal using only relations visible in the verified account. */
export function createPostgresPipelineDealCreateRepository(
  getVerifiedSession: AccountGuardDependencies['getVerifiedSession']
): {
  createDeal: (input: CreatePipelineDealInput) => Promise<string>;
} {
  const guards = createDefaultPostgresAccountGuards(getVerifiedSession);

  async function createDeal(input: CreatePipelineDealInput): Promise<string> {
    const context = await guards.requireRole('agent');
    const normalized = normalizeInput(input);

    const result = await withTransaction(async (transaction) => {
      // Existing RLS policies resolve auth.uid() from this transaction-local GUC.
      await transaction.query(
        "SELECT set_config('request.jwt.claim.sub', $1, true)",
        [context.userId]
      );

      const inserted = await transaction.query<CreatedDealRow>(
        `INSERT INTO public.deals (
           user_id, account_id, pipeline_id, stage_id, contact_id, assigned_to,
           title, value, currency, notes, expected_close_date, status
         )
         SELECT $1, $2, p.id, stage.id, contact.id, assignee.id,
                $7, $8, $9, $10, $11, 'open'
         FROM public.pipelines AS p
         INNER JOIN public.pipeline_stages AS stage
           ON stage.id = $4
          AND stage.pipeline_id = p.id
         INNER JOIN public.contacts AS contact
           ON contact.id = $5
          AND contact.account_id = p.account_id
         LEFT JOIN public.profiles AS assignee
           ON assignee.id = $6
          AND assignee.account_id = p.account_id
         WHERE p.id = $3
           AND p.account_id = $2
           AND ($6::uuid IS NULL OR assignee.id IS NOT NULL)
         RETURNING id::text AS id`,
        [
          context.userId,
          context.accountId,
          normalized.pipelineId,
          normalized.stageId,
          normalized.contactId,
          normalized.assignedTo,
          normalized.title,
          normalized.value,
          normalized.currency,
          normalized.notes,
          normalized.expectedCloseDate,
        ]
      );

      if (inserted.rows.length === 0) throw new AppError('not_found');
      if (inserted.rows.length !== 1) throw new AppError('conflict');
      return returnedUuid(inserted.rows[0].id);
    });

    if (!result.ok) throw result.error;
    return result.data;
  }

  return { createDeal };
}
