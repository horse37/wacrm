import 'server-only';

import type { QueryResultRow } from 'pg';
import type { TemplateButton, TemplateSampleValues } from '../../types';
import type { TemplatePayload } from '../whatsapp/template-validators';
import { validateTemplatePayload } from '../whatsapp/template-validators';
import type { AccountGuardDependencies } from '../auth/postgres-account-guard';
import { createDefaultPostgresAccountGuards } from '../auth/postgres-account-guard';
import { AppError } from '../db/errors';
import { withTransaction } from '../db/postgres-client';

interface TemplateEditSnapshot {
  templateId: string;
  lastSubmittedAt: string;
  outcome:
    | { kind: 'provider_failure'; error: string }
    | { kind: 'provider_success'; payload: TemplatePayload };
}

interface TemplateEditRow extends QueryResultRow {
  id: unknown;
  status: unknown;
  metaTemplateId: unknown;
}

interface TemplateEditPersistedRow extends QueryResultRow {
  id: unknown;
  user_id: unknown;
  account_id: unknown;
  name: unknown;
  category: unknown;
  language: unknown;
  header_type: unknown;
  header_content: unknown;
  body_text: unknown;
  footer_text: unknown;
  buttons: unknown;
  status: unknown;
  created_at: unknown;
  updated_at: unknown;
  sample_values: unknown;
  meta_template_id: unknown;
  rejection_reason: unknown;
  quality_score: unknown;
  header_handle: unknown;
  header_media_url: unknown;
  submission_error: unknown;
  last_submitted_at: unknown;
}
interface TemplateEditPersistedTemplate {
  id: string;
  user_id: string;
  account_id: string;
  name: string;
  category: string;
  language: string | null;
  header_type: string | null;
  header_content: string | null;
  body_text: string;
  footer_text: string | null;
  buttons: TemplateButton[] | null;
  status: string;
  created_at: Date | string | null;
  updated_at: Date | string | null;
  sample_values: TemplateSampleValues | null;
  meta_template_id: string | null;
  rejection_reason: string | null;
  quality_score: string | null;
  header_handle: string | null;
  header_media_url: string | null;
  submission_error: string | null;
  last_submitted_at: Date | string | null;
}
interface TemplateEditPersistenceRepository {
  persist(input: unknown): Promise<{
    id: string;
    action: 'updated';
    template: TemplateEditPersistedTemplate | null;
  }>;
}

const editableStatuses = new Set(['APPROVED', 'REJECTED', 'PAUSED']);
const templateCategories = new Set(['Marketing', 'Utility', 'Authentication']);
const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isNullableString(value: unknown): value is string | null | undefined {
  return value === undefined || value === null || typeof value === 'string';
}

function isStringArray(value: unknown): value is string[] {
  return (
    Array.isArray(value) && value.every((item) => typeof item === 'string')
  );
}

function isTemplateButton(value: unknown): value is TemplateButton {
  if (!isRecord(value) || typeof value.type !== 'string') return false;
  if (typeof value.text !== 'string') return false;
  switch (value.type) {
    case 'QUICK_REPLY':
      return true;
    case 'URL':
      return (
        typeof value.url === 'string' &&
        (value.example === undefined || typeof value.example === 'string')
      );
    case 'PHONE_NUMBER':
      return typeof value.phone_number === 'string';
    case 'COPY_CODE':
      return typeof value.example === 'string';
    default:
      return false;
  }
}

function isButtons(
  value: unknown
): value is TemplateButton[] | null | undefined {
  return (
    value === undefined ||
    value === null ||
    (Array.isArray(value) &&
      value.length <= 10 &&
      value.every(isTemplateButton))
  );
}

function isSampleValues(
  value: unknown
): value is TemplateSampleValues | null | undefined {
  if (value === undefined || value === null) return true;
  if (
    !isRecord(value) ||
    Object.keys(value).some((key) => key !== 'body' && key !== 'header')
  ) {
    return false;
  }
  return (
    (value.body === undefined || isStringArray(value.body)) &&
    (value.header === undefined || isStringArray(value.header))
  );
}

function hasTemplatePayloadShape(value: unknown): value is TemplatePayload {
  if (!isRecord(value)) return false;
  const headerTypes = new Set(['text', 'image', 'video', 'document']);
  return (
    typeof value.name === 'string' &&
    typeof value.category === 'string' &&
    typeof value.language === 'string' &&
    (value.header_type === undefined ||
      value.header_type === null ||
      (typeof value.header_type === 'string' &&
        headerTypes.has(value.header_type))) &&
    isNullableString(value.header_content) &&
    isNullableString(value.header_media_url) &&
    isNullableString(value.header_handle) &&
    typeof value.body_text === 'string' &&
    isNullableString(value.footer_text) &&
    isButtons(value.buttons) &&
    isSampleValues(value.sample_values)
  );
}

function prepareSnapshot(value: unknown): TemplateEditSnapshot {
  if (
    !isRecord(value) ||
    typeof value.templateId !== 'string' ||
    !uuidPattern.test(value.templateId) ||
    typeof value.lastSubmittedAt !== 'string' ||
    !Number.isFinite(Date.parse(value.lastSubmittedAt)) ||
    !isRecord(value.outcome)
  ) {
    throw new AppError('bad_request');
  }

  const templateId = value.templateId.toLowerCase();
  if (value.outcome.kind === 'provider_failure') {
    if (
      typeof value.outcome.error !== 'string' ||
      value.outcome.error.trim().length === 0
    ) {
      throw new AppError('bad_request');
    }
    return {
      templateId,
      lastSubmittedAt: value.lastSubmittedAt,
      outcome: { kind: 'provider_failure', error: value.outcome.error },
    };
  }

  if (
    value.outcome.kind !== 'provider_success' ||
    !hasTemplatePayloadShape(value.outcome.payload) ||
    typeof value.outcome.payload.category !== 'string' ||
    !templateCategories.has(value.outcome.payload.category) ||
    value.outcome.payload.category === 'Authentication'
  ) {
    throw new AppError('bad_request');
  }

  try {
    validateTemplatePayload(value.outcome.payload);
  } catch {
    throw new AppError('bad_request');
  }

  return {
    templateId,
    lastSubmittedAt: value.lastSubmittedAt,
    outcome: {
      kind: 'provider_success',
      payload: value.outcome.payload,
    },
  };
}

function templateId(value: unknown): string {
  if (typeof value !== 'string' || !uuidPattern.test(value)) {
    throw new AppError('db_error');
  }
  return value.toLowerCase();
}

function requiredTemplateUuid(value: unknown): string {
  if (typeof value !== 'string' || !uuidPattern.test(value)) {
    throw new AppError('db_error');
  }
  return value.toLowerCase();
}

function requiredString(value: unknown): string {
  if (typeof value !== 'string') throw new AppError('db_error');
  return value;
}

function nullableString(value: unknown): string | null {
  if (value !== null && typeof value !== 'string') {
    throw new AppError('db_error');
  }
  return value;
}

function nullableTimestamp(value: unknown): Date | string | null {
  if (value === null) return null;
  if (value instanceof Date && Number.isFinite(value.getTime())) {
    return value;
  }
  if (typeof value === 'string' && Number.isFinite(Date.parse(value))) {
    return value;
  }
  throw new AppError('db_error');
}

function toPersistedTemplate(
  row: TemplateEditPersistedRow
): TemplateEditPersistedTemplate {
  if (!isButtons(row.buttons) || !isSampleValues(row.sample_values)) {
    throw new AppError('db_error');
  }
  return {
    id: requiredTemplateUuid(row.id),
    user_id: requiredTemplateUuid(row.user_id),
    account_id: requiredTemplateUuid(row.account_id),
    name: requiredString(row.name),
    category: requiredString(row.category),
    language: nullableString(row.language),
    header_type: nullableString(row.header_type),
    header_content: nullableString(row.header_content),
    body_text: requiredString(row.body_text),
    footer_text: nullableString(row.footer_text),
    buttons: row.buttons ?? null,
    status: requiredString(row.status),
    created_at: nullableTimestamp(row.created_at),
    updated_at: nullableTimestamp(row.updated_at),
    sample_values: row.sample_values ?? null,
    meta_template_id: nullableString(row.meta_template_id),
    rejection_reason: nullableString(row.rejection_reason),
    quality_score: nullableString(row.quality_score),
    header_handle: nullableString(row.header_handle),
    header_media_url: nullableString(row.header_media_url),
    submission_error: nullableString(row.submission_error),
    last_submitted_at: nullableTimestamp(row.last_submitted_at),
  };
}

function jsonParameter(value: unknown): string | null {
  return value === null ? null : JSON.stringify(value);
}

/** Persist one local result after a lifecycle edit has already completed or failed upstream. */
export function createPostgresTemplateEditPersistenceRepository(
  getVerifiedSession: AccountGuardDependencies['getVerifiedSession']
): TemplateEditPersistenceRepository {
  const guards = createDefaultPostgresAccountGuards(getVerifiedSession);

  async function persist(input: unknown): Promise<{
    id: string;
    action: 'updated';
    template: TemplateEditPersistedTemplate | null;
  }> {
    const snapshot = prepareSnapshot(input);
    const context = await guards.requireRole('admin');
    const result = await withTransaction(async (transaction) => {
      await transaction.query(
        "SELECT set_config('request.jwt.claim.sub', $1, true)",
        [context.userId]
      );

      const matches = await transaction.query<TemplateEditRow>(
        `SELECT
           template.id::text AS id,
           template.status AS status,
           template.meta_template_id AS "metaTemplateId"
         FROM public.message_templates AS template
         WHERE template.id = $1
           AND template.account_id = $2
         LIMIT 2
         FOR UPDATE OF template`,
        [snapshot.templateId, context.accountId]
      );

      if (matches.rows.length > 1) throw new AppError('conflict');
      const current = matches.rows[0];
      if (!current) throw new AppError('not_found');
      if (
        typeof current.status !== 'string' ||
        typeof current.metaTemplateId !== 'string' ||
        current.metaTemplateId.length === 0
      ) {
        throw new AppError('conflict');
      }
      if (!editableStatuses.has(current.status)) {
        throw new AppError('conflict');
      }
      const matchedId = templateId(current.id);

      if (snapshot.outcome.kind === 'provider_failure') {
        const updated = await transaction.query<TemplateEditRow>(
          `UPDATE public.message_templates AS template
           SET submission_error = $1,
               last_submitted_at = $2
           WHERE template.id = $3
             AND template.account_id = $4
           RETURNING template.id::text AS id`,
          [
            snapshot.outcome.error,
            snapshot.lastSubmittedAt,
            matchedId,
            context.accountId,
          ]
        );
        if (updated.rows.length !== 1) throw new AppError('conflict');
        return {
          id: templateId(updated.rows[0].id),
          action: 'updated' as const,
          template: null,
        };
      }

      const updated = await transaction.query<TemplateEditPersistedRow>(
        `UPDATE public.message_templates AS template
           SET category = $1,
               header_type = $2,
               header_content = $3,
               header_media_url = $4,
               header_handle = $5,
               body_text = $6,
               footer_text = $7,
               buttons = $8::jsonb,
               sample_values = $9::jsonb,
               status = 'PENDING',
               submission_error = NULL,
               rejection_reason = NULL,
               last_submitted_at = $10
           WHERE template.id = $11
             AND template.account_id = $12
           RETURNING
             template.id::text AS id,
             template.user_id::text AS user_id,
             template.account_id::text AS account_id,
             template.name,
             template.category,
             template.language,
             template.header_type,
             template.header_content,
             template.body_text,
             template.footer_text,
             template.buttons,
             template.status,
             template.created_at,
             template.updated_at,
             template.sample_values,
             template.meta_template_id,
             template.rejection_reason,
             template.quality_score,
             template.header_handle,
             template.header_media_url,
             template.submission_error,
             template.last_submitted_at`,
        [
          snapshot.outcome.payload.category,
          snapshot.outcome.payload.header_type ?? null,
          snapshot.outcome.payload.header_content ?? null,
          snapshot.outcome.payload.header_media_url ?? null,
          snapshot.outcome.payload.header_handle ?? null,
          snapshot.outcome.payload.body_text,
          snapshot.outcome.payload.footer_text ?? null,
          jsonParameter(snapshot.outcome.payload.buttons ?? null),
          jsonParameter(snapshot.outcome.payload.sample_values ?? null),
          snapshot.lastSubmittedAt,
          matchedId,
          context.accountId,
        ]
      );
      if (updated.rows.length !== 1) throw new AppError('conflict');
      return {
        id: templateId(updated.rows[0].id),
        action: 'updated' as const,
        template: toPersistedTemplate(updated.rows[0]),
      };
    });

    if (!result.ok) throw result.error;
    return result.data;
  }

  return { persist };
}
