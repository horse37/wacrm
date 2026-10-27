import 'server-only';

import type { QueryResultRow } from 'pg';
import type {
  MessageTemplateStatus,
  TemplateButton,
  TemplateSampleValues,
} from '../../types';
import type { AccountGuardDependencies } from '../auth/postgres-account-guard';
import { createDefaultPostgresAccountGuards } from '../auth/postgres-account-guard';
import { AppError } from '../db/errors';
import { withTransaction } from '../db/postgres-client';
import { validateTemplatePayload } from '../whatsapp/template-validators';

export type TemplateSubmitCategory = 'Marketing' | 'Utility' | 'Authentication';
export type TemplateSubmitHeaderType = 'text' | 'image' | 'video' | 'document';

export interface TemplateSubmitSnapshot {
  name: string;
  category: TemplateSubmitCategory;
  language: string;
  headerType: TemplateSubmitHeaderType | null;
  headerContent: string | null;
  headerMediaUrl: string | null;
  headerHandle: string | null;
  bodyText: string;
  footerText: string | null;
  buttons: TemplateButton[] | null;
  sampleValues: TemplateSampleValues | null;
  status: MessageTemplateStatus;
  metaTemplateId: string | null;
  submissionError: string | null;
  lastSubmittedAt: string;
}

interface TemplateSubmitRow extends QueryResultRow {
  id: unknown;
  created_at: unknown;
  updated_at: unknown;
  quality_score: unknown;
}

export interface TemplateSubmitPersistedResult {
  id: string;
  action: 'inserted' | 'updated';
  createdAt: string;
  updatedAt: string;
  qualityScore: 'GREEN' | 'YELLOW' | 'RED' | null;
}

const categories = new Set<TemplateSubmitCategory>([
  'Marketing',
  'Utility',
  'Authentication',
]);
const headerTypes = new Set<TemplateSubmitHeaderType>([
  'text',
  'image',
  'video',
  'document',
]);
const statuses = new Set<MessageTemplateStatus>([
  'DRAFT',
  'PENDING',
  'APPROVED',
  'REJECTED',
  'PAUSED',
  'DISABLED',
  'IN_APPEAL',
  'PENDING_DELETION',
]);
const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isNullableString(value: unknown): value is string | null {
  return value === null || typeof value === 'string';
}

function isStringArray(value: unknown): value is string[] {
  return (
    Array.isArray(value) && value.every((item) => typeof item === 'string')
  );
}

function isTemplateButton(value: unknown): value is TemplateButton {
  if (!isRecord(value) || typeof value.type !== 'string') return false;
  if (typeof value.text !== 'string' || value.text.trim().length === 0) {
    return false;
  }

  switch (value.type) {
    case 'QUICK_REPLY':
      return true;
    case 'URL':
      return (
        typeof value.url === 'string' &&
        value.url.trim().length > 0 &&
        (value.example === undefined || typeof value.example === 'string')
      );
    case 'PHONE_NUMBER':
      return (
        typeof value.phone_number === 'string' &&
        value.phone_number.trim().length > 0
      );
    case 'COPY_CODE':
      return typeof value.example === 'string' && value.example.length > 0;
    default:
      return false;
  }
}

function isButtons(value: unknown): value is TemplateButton[] | null {
  return (
    value === null ||
    (Array.isArray(value) &&
      value.length <= 10 &&
      value.every(isTemplateButton))
  );
}

function isSampleValues(value: unknown): value is TemplateSampleValues | null {
  if (value === null) return true;
  if (!isRecord(value)) return false;
  if (Object.keys(value).some((key) => key !== 'body' && key !== 'header')) {
    return false;
  }
  return (
    (value.body === undefined || isStringArray(value.body)) &&
    (value.header === undefined || isStringArray(value.header))
  );
}

function validateSnapshot(value: unknown): TemplateSubmitSnapshot {
  if (!isRecord(value)) throw new AppError('bad_request');
  if (
    typeof value.name !== 'string' ||
    value.name.trim().length === 0 ||
    typeof value.language !== 'string' ||
    value.language.trim().length === 0 ||
    typeof value.category !== 'string' ||
    !categories.has(value.category as TemplateSubmitCategory) ||
    value.category === 'Authentication' ||
    (value.headerType !== null &&
      (typeof value.headerType !== 'string' ||
        !headerTypes.has(value.headerType as TemplateSubmitHeaderType))) ||
    !isNullableString(value.headerContent) ||
    !isNullableString(value.headerMediaUrl) ||
    !isNullableString(value.headerHandle) ||
    typeof value.bodyText !== 'string' ||
    !isNullableString(value.footerText) ||
    !isButtons(value.buttons) ||
    !isSampleValues(value.sampleValues) ||
    typeof value.status !== 'string' ||
    !statuses.has(value.status as MessageTemplateStatus) ||
    !isNullableString(value.metaTemplateId) ||
    (typeof value.metaTemplateId === 'string' &&
      value.metaTemplateId.trim().length === 0) ||
    !isNullableString(value.submissionError) ||
    typeof value.lastSubmittedAt !== 'string' ||
    !Number.isFinite(Date.parse(value.lastSubmittedAt))
  ) {
    throw new AppError('bad_request');
  }

  const snapshot = value as unknown as TemplateSubmitSnapshot;
  if (snapshot.submissionError !== null) {
    if (
      snapshot.status !== 'DRAFT' ||
      snapshot.metaTemplateId !== null ||
      snapshot.submissionError.trim().length === 0
    ) {
      throw new AppError('bad_request');
    }
  } else if (snapshot.metaTemplateId === null) {
    throw new AppError('bad_request');
  }

  try {
    validateTemplatePayload({
      name: snapshot.name,
      category: snapshot.category,
      language: snapshot.language,
      header_type: snapshot.headerType ?? undefined,
      header_content: snapshot.headerContent ?? undefined,
      header_media_url: snapshot.headerMediaUrl ?? undefined,
      header_handle: snapshot.headerHandle ?? undefined,
      body_text: snapshot.bodyText,
      footer_text: snapshot.footerText ?? undefined,
      buttons: snapshot.buttons ?? undefined,
      sample_values: snapshot.sampleValues ?? undefined,
    });
  } catch {
    throw new AppError('bad_request');
  }

  return snapshot;
}

function templateId(value: unknown): string {
  if (typeof value !== 'string' || !uuidPattern.test(value)) {
    throw new AppError('db_error');
  }
  return value.toLowerCase();
}

function persistedTimestamp(value: unknown): string {
  const timestamp =
    value instanceof Date
      ? value
      : typeof value === 'string'
        ? new Date(value)
        : null;
  if (!timestamp || !Number.isFinite(timestamp.getTime())) {
    throw new AppError('db_error');
  }
  return timestamp.toISOString();
}

function persistedQualityScore(
  value: unknown
): TemplateSubmitPersistedResult['qualityScore'] {
  if (value === null) return null;
  if (value === 'GREEN' || value === 'YELLOW' || value === 'RED') {
    return value;
  }
  throw new AppError('db_error');
}

function persistedResult(
  row: TemplateSubmitRow,
  action: TemplateSubmitPersistedResult['action']
): TemplateSubmitPersistedResult {
  return {
    id: templateId(row.id),
    action,
    createdAt: persistedTimestamp(row.created_at),
    updatedAt: persistedTimestamp(row.updated_at),
    qualityScore: persistedQualityScore(row.quality_score),
  };
}

function jsonParameter(value: unknown): string | null {
  return value === null ? null : JSON.stringify(value);
}

/** Persist one provider-independent template submission outcome for a verified admin. */
export function createPostgresTemplateSubmitPersistenceRepository(
  getVerifiedSession: AccountGuardDependencies['getVerifiedSession']
): {
  upsertOne: (input: unknown) => Promise<TemplateSubmitPersistedResult>;
} {
  const guards = createDefaultPostgresAccountGuards(getVerifiedSession);

  async function upsertOne(
    input: unknown
  ): Promise<TemplateSubmitPersistedResult> {
    const snapshot = validateSnapshot(input);
    const context = await guards.requireRole('admin');
    const result = await withTransaction(async (transaction) => {
      await transaction.query(
        "SELECT set_config('request.jwt.claim.sub', $1, true)",
        [context.userId]
      );

      // The migration's legacy conflict key is per user, not per account.
      await transaction.query(
        `SELECT pg_advisory_xact_lock(
           hashtextextended($1 || ':' || $2 || ':' || $3, 0)
         )`,
        [context.userId, snapshot.name, snapshot.language]
      );

      const matches = await transaction.query<TemplateSubmitRow>(
        `SELECT template.id::text AS id
         FROM public.message_templates AS template
         INNER JOIN public.profiles AS creator
           ON creator.user_id = template.user_id
          AND creator.account_id = template.account_id
         WHERE template.account_id = $1
           AND template.user_id = $2
           AND template.name = $3
           AND template.language = $4
         LIMIT 2`,
        [context.accountId, context.userId, snapshot.name, snapshot.language]
      );

      if (matches.rows.length > 1) throw new AppError('conflict');

      const values = [
        context.accountId,
        context.userId,
        snapshot.name,
        snapshot.category,
        snapshot.language,
        snapshot.headerType,
        snapshot.headerContent,
        snapshot.headerMediaUrl,
        snapshot.headerHandle,
        snapshot.bodyText,
        snapshot.footerText,
        jsonParameter(snapshot.buttons),
        jsonParameter(snapshot.sampleValues),
        snapshot.status,
        snapshot.metaTemplateId,
        snapshot.submissionError,
        null,
        snapshot.lastSubmittedAt,
      ] as const;

      if (matches.rows.length === 1) {
        const id = templateId(matches.rows[0].id);
        const updated = await transaction.query<TemplateSubmitRow>(
          `UPDATE public.message_templates AS template
           SET account_id = $1,
               user_id = $2,
               name = $3,
               category = $4,
               language = $5,
               header_type = $6,
               header_content = $7,
               header_media_url = $8,
               header_handle = $9,
               body_text = $10,
               footer_text = $11,
               buttons = $12::jsonb,
               sample_values = $13::jsonb,
               status = $14,
               meta_template_id = $15,
               submission_error = $16,
               rejection_reason = $17,
               last_submitted_at = $18
           WHERE template.id = $19
             AND template.account_id = $1
             AND template.user_id = $2
         RETURNING
           template.id::text AS id,
           template.created_at,
           template.updated_at,
           template.quality_score`,
          [...values, id]
        );

        if (updated.rows.length !== 1) throw new AppError('conflict');
        return persistedResult(updated.rows[0], 'updated');
      }

      const inserted = await transaction.query<TemplateSubmitRow>(
        `INSERT INTO public.message_templates (
           account_id,
           user_id,
           name,
           category,
           language,
           header_type,
           header_content,
           header_media_url,
           header_handle,
           body_text,
           footer_text,
           buttons,
           sample_values,
           status,
           meta_template_id,
           submission_error,
           rejection_reason,
           last_submitted_at
         )
         VALUES (
           $1, $2, $3, $4, $5, $6, $7, $8, $9,
           $10, $11, $12::jsonb, $13::jsonb, $14,
           $15, $16, $17, $18
         )
       RETURNING
         id::text AS id,
         created_at,
         updated_at,
         quality_score`,
        values
      );

      if (inserted.rows.length !== 1) throw new AppError('db_error');
      return persistedResult(inserted.rows[0], 'inserted');
    });

    if (!result.ok) throw result.error;
    return result.data;
  }

  return { upsertOne };
}
