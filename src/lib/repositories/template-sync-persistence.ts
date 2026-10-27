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

export type TemplateSyncCategory = 'Marketing' | 'Utility' | 'Authentication';
export type TemplateSyncHeaderType = 'text' | 'image' | 'video' | 'document';
export type TemplateSyncQualityScore = 'GREEN' | 'YELLOW' | 'RED';

export interface TemplateSyncSnapshot {
  name: string;
  category: TemplateSyncCategory;
  language: string;
  headerType: TemplateSyncHeaderType | null;
  headerContent: string | null;
  headerHandle: string | null;
  bodyText: string;
  footerText: string | null;
  buttons: TemplateButton[] | null;
  sampleValues: TemplateSampleValues | null;
  status: MessageTemplateStatus;
  metaTemplateId: string;
  qualityScore: TemplateSyncQualityScore | null;
  updatedAt: string;
}

interface TemplateSyncRow extends QueryResultRow {
  id: unknown;
}

const categories = new Set<TemplateSyncCategory>([
  'Marketing',
  'Utility',
  'Authentication',
]);
const headerTypes = new Set<TemplateSyncHeaderType>([
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
const qualityScores = new Set<TemplateSyncQualityScore>([
  'GREEN',
  'YELLOW',
  'RED',
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

function validateSnapshot(value: unknown): TemplateSyncSnapshot {
  if (!isRecord(value)) throw new AppError('bad_request');
  if (
    typeof value.name !== 'string' ||
    value.name.trim().length === 0 ||
    typeof value.language !== 'string' ||
    value.language.trim().length === 0 ||
    typeof value.category !== 'string' ||
    !categories.has(value.category as TemplateSyncCategory) ||
    (value.headerType !== null &&
      (typeof value.headerType !== 'string' ||
        !headerTypes.has(value.headerType as TemplateSyncHeaderType))) ||
    !isNullableString(value.headerContent) ||
    !isNullableString(value.headerHandle) ||
    typeof value.bodyText !== 'string' ||
    !isNullableString(value.footerText) ||
    !isButtons(value.buttons) ||
    !isSampleValues(value.sampleValues) ||
    typeof value.status !== 'string' ||
    !statuses.has(value.status as MessageTemplateStatus) ||
    typeof value.metaTemplateId !== 'string' ||
    value.metaTemplateId.trim().length === 0 ||
    (value.qualityScore !== null &&
      (typeof value.qualityScore !== 'string' ||
        !qualityScores.has(value.qualityScore as TemplateSyncQualityScore))) ||
    typeof value.updatedAt !== 'string' ||
    !Number.isFinite(Date.parse(value.updatedAt))
  ) {
    throw new AppError('bad_request');
  }

  return value as unknown as TemplateSyncSnapshot;
}

function templateId(value: unknown): string {
  if (typeof value !== 'string' || !uuidPattern.test(value)) {
    throw new AppError('db_error');
  }
  return value.toLowerCase();
}

function jsonParameter(value: unknown): string | null {
  return value === null ? null : JSON.stringify(value);
}

/** Persist one provider-independent template-sync snapshot for a verified admin. */
export function createPostgresTemplateSyncPersistenceRepository(
  getVerifiedSession: AccountGuardDependencies['getVerifiedSession']
): {
  upsertOne: (
    input: unknown
  ) => Promise<{ id: string; action: 'inserted' | 'updated' }>;
} {
  const guards = createDefaultPostgresAccountGuards(getVerifiedSession);

  async function upsertOne(
    input: unknown
  ): Promise<{ id: string; action: 'inserted' | 'updated' }> {
    const snapshot = validateSnapshot(input);
    const context = await guards.requireRole('admin');
    const result = await withTransaction(async (transaction) => {
      // Keep auth.uid() scoped to this transaction and never in the pool.
      await transaction.query(
        "SELECT set_config('request.jwt.claim.sub', $1, true)",
        [context.userId]
      );

      // Serialize syncs for the same exact account/name/language tuple.
      await transaction.query(
        `SELECT pg_advisory_xact_lock(
           hashtextextended($1 || ':' || $2 || ':' || $3, 0)
         )`,
        [context.accountId, snapshot.name, snapshot.language]
      );

      const matches = await transaction.query<TemplateSyncRow>(
        `SELECT template.id::text AS id
         FROM public.message_templates AS template
         WHERE template.account_id = $1
           AND template.name = $2
           AND template.language = $3
         LIMIT 2`,
        [context.accountId, snapshot.name, snapshot.language]
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
        snapshot.headerHandle,
        snapshot.bodyText,
        snapshot.footerText,
        jsonParameter(snapshot.buttons),
        jsonParameter(snapshot.sampleValues),
        snapshot.status,
        snapshot.metaTemplateId,
        snapshot.qualityScore,
        snapshot.updatedAt,
      ] as const;

      if (matches.rows.length === 1) {
        const id = templateId(matches.rows[0].id);
        const updated = await transaction.query<TemplateSyncRow>(
          `UPDATE public.message_templates AS template
           SET account_id = $1,
               user_id = $2,
               name = $3,
               category = $4,
               language = $5,
               header_type = $6,
               header_content = $7,
               header_handle = $8,
               body_text = $9,
               footer_text = $10,
               buttons = $11::jsonb,
               sample_values = $12::jsonb,
               status = $13,
               meta_template_id = $14,
               quality_score = $15,
               updated_at = $16
           WHERE template.id = $17
             AND template.account_id = $1
           RETURNING template.id::text AS id`,
          [...values, id]
        );

        if (updated.rows.length !== 1) throw new AppError('conflict');
        return {
          id: templateId(updated.rows[0].id),
          action: 'updated' as const,
        };
      }

      const inserted = await transaction.query<TemplateSyncRow>(
        `INSERT INTO public.message_templates (
           account_id,
           user_id,
           name,
           category,
           language,
           header_type,
           header_content,
           header_handle,
           body_text,
           footer_text,
           buttons,
           sample_values,
           status,
           meta_template_id,
           quality_score,
           updated_at
         )
         VALUES (
           $1, $2, $3, $4, $5, $6, $7, $8,
           $9, $10, $11::jsonb, $12::jsonb,
           $13, $14, $15, $16
         )
         RETURNING id::text AS id`,
        values
      );

      if (inserted.rows.length !== 1) throw new AppError('db_error');
      return {
        id: templateId(inserted.rows[0].id),
        action: 'inserted' as const,
      };
    });

    if (!result.ok) throw result.error;
    return result.data;
  }

  return { upsertOne };
}
