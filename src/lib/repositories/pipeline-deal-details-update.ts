import 'server-only';

import type { QueryResultRow } from 'pg';
import { CURRENCIES } from '../currency';
import type { AccountGuardDependencies } from '../auth/postgres-account-guard';
import { createDefaultPostgresAccountGuards } from '../auth/postgres-account-guard';
import { AppError } from '../db/errors';
import { withTransaction } from '../db/postgres-client';

export interface UpdatePipelineDealDetailsInput {
  dealId: string;
  pipelineId: string;
  stageId: string;
  contactId: string;
  assignedTo?: string | null;
  title: string;
  value: number;
  currency: string;
  notes?: string | null;
  expectedCloseDate?: string | null;
}

interface NormalizedUpdatePipelineDealDetailsInput {
  dealId: string;
  pipelineId: string;
  stageId: string;
  contactId: string;
  assignedTo: string | null;
  title: string;
  value: number;
  currency: string;
  notes: string | null;
  expectedCloseDate: string | null;
}

interface UpdatedDealRow extends QueryResultRow {
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

function normalizeInput(
  input: unknown
): NormalizedUpdatePipelineDealDetailsInput {
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
    dealId: requestedUuid(record.dealId),
    pipelineId: requestedUuid(record.pipelineId),
    stageId: requestedUuid(record.stageId),
    contactId: requestedUuid(record.contactId),
    assignedTo: optionalUuid(record.assignedTo),
    title: record.title.trim(),
    value: record.value,
    currency,
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

/** Update only editable form fields for one deal in the verified account. */
export function createPostgresPipelineDealDetailsUpdateRepository(
  getVerifiedSession: AccountGuardDependencies['getVerifiedSession']
): {
  updateDetails: (input: UpdatePipelineDealDetailsInput) => Promise<void>;
} {
  const guards = createDefaultPostgresAccountGuards(getVerifiedSession);

  async function updateDetails(
    input: UpdatePipelineDealDetailsInput
  ): Promise<void> {
    const context = await guards.requireRole('agent');
    const normalized = normalizeInput(input);

    const result = await withTransaction(async (transaction) => {
      // Existing RLS policies resolve auth.uid() from this transaction-local GUC.
      await transaction.query(
        "SELECT set_config('request.jwt.claim.sub', $1, true)",
        [context.userId]
      );

      const update = await transaction.query<UpdatedDealRow>(
        `UPDATE public.deals AS d
         SET title = $7,
             value = $8,
             currency = $9,
             stage_id = $4,
             contact_id = $5,
             assigned_to = $6,
             notes = $10,
             expected_close_date = $11
         WHERE d.account_id = $1
           AND d.id = $2
           AND d.pipeline_id = $3
           AND EXISTS (
             SELECT 1
             FROM public.pipelines AS p
             WHERE p.id = d.pipeline_id
               AND p.account_id = d.account_id
           )
           AND EXISTS (
             SELECT 1
             FROM public.pipeline_stages AS target_stage
             WHERE target_stage.id = $4
               AND target_stage.pipeline_id = d.pipeline_id
           )
           AND EXISTS (
             SELECT 1
             FROM public.contacts AS contact
             WHERE contact.id = $5
               AND contact.account_id = d.account_id
           )
           AND (
             $6::uuid IS NULL
             OR EXISTS (
               SELECT 1
               FROM public.profiles AS assignee
               WHERE assignee.id = $6
                 AND assignee.account_id = d.account_id
             )
           )
         RETURNING d.id::text AS id`,
        [
          context.accountId,
          normalized.dealId,
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

      if (update.rows.length === 0) throw new AppError('not_found');
      if (update.rows.length !== 1) throw new AppError('conflict');
      if (returnedUuid(update.rows[0].id) !== normalized.dealId) {
        throw new AppError('db_error');
      }
    });

    if (!result.ok) throw result.error;
  }

  return { updateDetails };
}
