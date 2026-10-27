import 'server-only';

import type { QueryResultRow } from 'pg';
import type { MessageTemplate, TemplateButton } from '../../types';
import type { AccountGuardDependencies } from '../auth/postgres-account-guard';
import { createDefaultPostgresAccountGuards } from '../auth/postgres-account-guard';
import { AppError } from '../db/errors';
import { withTransaction } from '../db/postgres-client';

export type TemplateSendDefinition = Pick<
  MessageTemplate,
  'id' | 'user_id' | 'name' | 'category' | 'body_text' | 'created_at'
> & {
  header_type?: MessageTemplate['header_type'];
  header_content?: string;
  header_media_url?: string;
  buttons?: TemplateButton[];
};

interface TemplateSendDefinitionRow extends QueryResultRow {
  id: string | null;
  userId: string | null;
  name: string | null;
  category: string | null;
  bodyText: string | null;
  createdAt: string | null;
  headerType: string | null;
  headerContent: string | null;
  headerMediaUrl: string | null;
  buttons: unknown;
}

type TemplateCategory = MessageTemplate['category'];
type TemplateHeaderType = NonNullable<MessageTemplate['header_type']>;

const templateCategories = new Set<TemplateCategory>([
  'Marketing',
  'Utility',
  'Authentication',
]);
const templateHeaderTypes = new Set<TemplateHeaderType>([
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

function templateCategory(value: unknown): TemplateCategory {
  if (
    typeof value !== 'string' ||
    !templateCategories.has(value as TemplateCategory)
  ) {
    throw new AppError('db_error');
  }
  return value as TemplateCategory;
}

function templateHeaderType(value: unknown): TemplateHeaderType | null {
  if (value === null) return null;
  if (
    typeof value !== 'string' ||
    !templateHeaderTypes.has(value as TemplateHeaderType)
  ) {
    throw new AppError('db_error');
  }
  return value as TemplateHeaderType;
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

function toTemplateSendDefinition(
  row: TemplateSendDefinitionRow
): TemplateSendDefinition {
  const headerType = templateHeaderType(row.headerType);
  const headerContent = nullableString(row.headerContent);
  const headerMediaUrl = nullableString(row.headerMediaUrl);
  const buttons = nullableButtons(row.buttons);

  return {
    id: uuidString(row.id),
    user_id: uuidString(row.userId),
    name: requiredString(row.name),
    category: templateCategory(row.category),
    body_text: requiredString(row.bodyText),
    created_at: requiredString(row.createdAt),
    ...(headerType === null ? {} : { header_type: headerType }),
    ...(headerContent === null ? {} : { header_content: headerContent }),
    ...(headerMediaUrl === null ? {} : { header_media_url: headerMediaUrl }),
    ...(buttons === null ? {} : { buttons }),
  };
}

/** Find one validated template definition usable by the send builder. */
export function createPostgresTemplateSendDefinitionRepository(
  getVerifiedSession: AccountGuardDependencies['getVerifiedSession']
): {
  findForCurrentAccount: (input: {
    name: string;
    language?: string | null;
  }) => Promise<TemplateSendDefinition | null>;
} {
  const guards = createDefaultPostgresAccountGuards(getVerifiedSession);

  async function findForCurrentAccount(input: {
    name: string;
    language?: string | null;
  }): Promise<TemplateSendDefinition | null> {
    if (
      typeof input?.name !== 'string' ||
      input.name.trim().length === 0 ||
      (input.language !== undefined &&
        input.language !== null &&
        typeof input.language !== 'string')
    ) {
      throw new AppError('bad_request');
    }
    const language = input.language || 'en_US';
    const context = await guards.requireAccount();

    const result = await withTransaction(async (transaction) => {
      // Existing RLS policies resolve auth.uid() from this transaction-local GUC.
      await transaction.query(
        "SELECT set_config('request.jwt.claim.sub', $1, true)",
        [context.userId]
      );

      const query = await transaction.query<TemplateSendDefinitionRow>(
        `SELECT
           template.id::text AS id,
           template.user_id::text AS "userId",
           template.name,
           template.category,
           template.body_text AS "bodyText",
           template.created_at::text AS "createdAt",
           template.header_type AS "headerType",
           template.header_content AS "headerContent",
           template.header_media_url AS "headerMediaUrl",
           template.buttons
         FROM public.message_templates AS template
         WHERE template.account_id = $1
           AND template.name = $2
           AND template.language = $3
         LIMIT 2`,
        [context.accountId, input.name, language]
      );

      if (query.rows.length === 0) return null;
      if (query.rows.length > 1) throw new AppError('conflict');
      return toTemplateSendDefinition(query.rows[0]);
    });

    if (!result.ok) throw result.error;
    return result.data;
  }

  return { findForCurrentAccount };
}
