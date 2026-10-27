import 'server-only';

import type { QueryResultRow } from 'pg';
import type { TemplateButton, TemplateSampleValues } from '../../types';
import type { AccountGuardDependencies } from '../auth/postgres-account-guard';
import { createDefaultPostgresAccountGuards } from '../auth/postgres-account-guard';
import { AppError } from '../db/errors';
import { withTransaction } from '../db/postgres-client';

export type TemplateEditorCategory = 'Marketing' | 'Utility' | 'Authentication';
export type TemplateEditorHeaderType = 'text' | 'image' | 'video' | 'document';

export interface TemplateEditorDetail {
  id: string;
  name: string;
  category: TemplateEditorCategory;
  language: string | null;
  header_type: TemplateEditorHeaderType | null;
  header_content: string | null;
  header_media_url: string | null;
  body_text: string;
  footer_text: string | null;
  buttons: TemplateButton[] | null;
  sample_values: TemplateSampleValues | null;
}

interface TemplateEditorDetailRow extends QueryResultRow {
  id: string | null;
  name: string | null;
  category: string | null;
  language: string | null;
  header_type: string | null;
  header_content: string | null;
  header_media_url: string | null;
  body_text: string | null;
  footer_text: string | null;
  buttons: unknown;
  sample_values: unknown;
}

const templateCategories = new Set<TemplateEditorCategory>([
  'Marketing',
  'Utility',
  'Authentication',
]);
const templateHeaderTypes = new Set<TemplateEditorHeaderType>([
  'text',
  'image',
  'video',
  'document',
]);
const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function isRecord(value: unknown): value is Record<string, unknown> {
  return (
    typeof value === 'object' &&
    value !== null &&
    !Array.isArray(value) &&
    (Object.getPrototypeOf(value) === Object.prototype ||
      Object.getPrototypeOf(value) === null)
  );
}

function hasOnlyKeys(
  value: Record<string, unknown>,
  allowed: readonly string[]
): boolean {
  return Object.keys(value).every((key) => allowed.includes(key));
}

function uuidString(value: unknown): string {
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

function templateCategory(value: unknown): TemplateEditorCategory {
  if (
    typeof value !== 'string' ||
    !templateCategories.has(value as TemplateEditorCategory)
  ) {
    throw new AppError('db_error');
  }
  return value as TemplateEditorCategory;
}

function templateHeaderType(value: unknown): TemplateEditorHeaderType | null {
  if (value === null) return null;
  if (
    typeof value !== 'string' ||
    !templateHeaderTypes.has(value as TemplateEditorHeaderType)
  ) {
    throw new AppError('db_error');
  }
  return value as TemplateEditorHeaderType;
}

function templateButton(value: unknown): TemplateButton {
  if (!isRecord(value) || typeof value.type !== 'string') {
    throw new AppError('db_error');
  }

  switch (value.type) {
    case 'QUICK_REPLY':
      if (
        !hasOnlyKeys(value, ['type', 'text']) ||
        typeof value.text !== 'string'
      ) {
        throw new AppError('db_error');
      }
      return { type: 'QUICK_REPLY', text: value.text };
    case 'URL':
      if (
        !hasOnlyKeys(value, ['type', 'text', 'url', 'example']) ||
        typeof value.text !== 'string' ||
        typeof value.url !== 'string' ||
        (value.example !== undefined && typeof value.example !== 'string')
      ) {
        throw new AppError('db_error');
      }
      return {
        type: 'URL',
        text: value.text,
        url: value.url,
        ...(value.example === undefined ? {} : { example: value.example }),
      };
    case 'PHONE_NUMBER':
      if (
        !hasOnlyKeys(value, ['type', 'text', 'phone_number']) ||
        typeof value.text !== 'string' ||
        typeof value.phone_number !== 'string'
      ) {
        throw new AppError('db_error');
      }
      return {
        type: 'PHONE_NUMBER',
        text: value.text,
        phone_number: value.phone_number,
      };
    case 'COPY_CODE':
      if (
        !hasOnlyKeys(value, ['type', 'text', 'example']) ||
        typeof value.text !== 'string' ||
        typeof value.example !== 'string'
      ) {
        throw new AppError('db_error');
      }
      return { type: 'COPY_CODE', text: value.text, example: value.example };
    default:
      throw new AppError('db_error');
  }
}

function nullableButtons(value: unknown): TemplateButton[] | null {
  if (value === null) return null;
  if (!Array.isArray(value) || value.length > 10) {
    throw new AppError('db_error');
  }
  return value.map(templateButton);
}

function sampleValues(value: unknown): TemplateSampleValues | null {
  if (value === null) return null;
  if (
    !isRecord(value) ||
    !hasOnlyKeys(value, ['body', 'header']) ||
    (value.body !== undefined &&
      (!Array.isArray(value.body) ||
        !value.body.every((entry) => typeof entry === 'string'))) ||
    (value.header !== undefined &&
      (!Array.isArray(value.header) ||
        !value.header.every((entry) => typeof entry === 'string')))
  ) {
    throw new AppError('db_error');
  }
  return {
    ...(value.body === undefined ? {} : { body: value.body as string[] }),
    ...(value.header === undefined ? {} : { header: value.header as string[] }),
  };
}

function toTemplateEditorDetail(
  row: TemplateEditorDetailRow
): TemplateEditorDetail {
  return {
    id: uuidString(row.id),
    name: requiredString(row.name),
    category: templateCategory(row.category),
    language: nullableString(row.language),
    header_type: templateHeaderType(row.header_type),
    header_content: nullableString(row.header_content),
    header_media_url: nullableString(row.header_media_url),
    body_text: requiredString(row.body_text),
    footer_text: nullableString(row.footer_text),
    buttons: nullableButtons(row.buttons),
    sample_values: sampleValues(row.sample_values),
  };
}

/** Read one validated template-editor form DTO for the verified user. */
export function createPostgresTemplateEditorDetailRepository(
  getVerifiedSession: AccountGuardDependencies['getVerifiedSession']
): {
  getForCurrentUser: (templateId: string) => Promise<TemplateEditorDetail>;
} {
  const guards = createDefaultPostgresAccountGuards(getVerifiedSession);

  async function getForCurrentUser(
    templateId: string
  ): Promise<TemplateEditorDetail> {
    if (typeof templateId !== 'string' || !uuidPattern.test(templateId)) {
      throw new AppError('bad_request');
    }

    const context = await guards.requireAccount();
    const result = await withTransaction(async (transaction) => {
      // Existing RLS policies resolve auth.uid() from this transaction-local GUC.
      await transaction.query(
        "SELECT set_config('request.jwt.claim.sub', $1, true)",
        [context.userId]
      );

      const query = await transaction.query<TemplateEditorDetailRow>(
        `SELECT
           template.id::text AS id,
           template.name,
           template.category,
           template.language,
           template.header_type,
           template.header_content,
           template.header_media_url,
           template.body_text,
           template.footer_text,
           template.buttons,
           template.sample_values
         FROM public.message_templates AS template
         INNER JOIN public.profiles AS creator
           ON creator.user_id = template.user_id
          AND creator.account_id = template.account_id
         WHERE template.id = $1
           AND template.account_id = $2
           AND template.user_id = $3`,
        [templateId.toLowerCase(), context.accountId, context.userId]
      );

      if (query.rows.length === 0) throw new AppError('not_found');
      if (query.rows.length !== 1) throw new AppError('conflict');
      return toTemplateEditorDetail(query.rows[0]);
    });

    if (!result.ok) throw result.error;
    return result.data;
  }

  return { getForCurrentUser };
}
