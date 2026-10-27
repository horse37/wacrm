import 'server-only';

import type { QueryResultRow } from 'pg';
import type { TemplateButton } from '../../types';
import type { AccountGuardDependencies } from '../auth/postgres-account-guard';
import { createDefaultPostgresAccountGuards } from '../auth/postgres-account-guard';
import { AppError } from '../db/errors';
import { withTransaction } from '../db/postgres-client';

export type InboxTemplateCategory = 'Marketing' | 'Utility' | 'Authentication';
export type InboxTemplateHeaderType = 'text' | 'image' | 'video' | 'document';

export interface InboxApprovedTemplate {
  id: string;
  name: string;
  category: InboxTemplateCategory;
  language: string | null;
  header_type: InboxTemplateHeaderType | null;
  header_content: string | null;
  body_text: string;
  footer_text: string | null;
  buttons: TemplateButton[] | null;
}

interface InboxApprovedTemplateRow extends QueryResultRow {
  id: string | null;
  name: string | null;
  category: string | null;
  language: string | null;
  headerType: string | null;
  headerContent: string | null;
  bodyText: string | null;
  footerText: string | null;
  buttons: unknown;
}

const templateCategories = new Set<InboxTemplateCategory>([
  'Marketing',
  'Utility',
  'Authentication',
]);
const templateHeaderTypes = new Set<InboxTemplateHeaderType>([
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

function templateCategory(value: unknown): InboxTemplateCategory {
  if (
    typeof value !== 'string' ||
    !templateCategories.has(value as InboxTemplateCategory)
  ) {
    throw new AppError('db_error');
  }
  return value as InboxTemplateCategory;
}

function templateHeaderType(value: unknown): InboxTemplateHeaderType | null {
  if (value === null) return null;
  if (
    typeof value !== 'string' ||
    !templateHeaderTypes.has(value as InboxTemplateHeaderType)
  ) {
    throw new AppError('db_error');
  }
  return value as InboxTemplateHeaderType;
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

function toInboxApprovedTemplate(
  row: InboxApprovedTemplateRow
): InboxApprovedTemplate {
  return {
    id: uuidString(row.id),
    name: requiredString(row.name),
    category: templateCategory(row.category),
    language: nullableString(row.language),
    header_type: templateHeaderType(row.headerType),
    header_content: nullableString(row.headerContent),
    body_text: requiredString(row.bodyText),
    footer_text: nullableString(row.footerText),
    buttons: nullableButtons(row.buttons),
  };
}

/** List minimal approved templates owned by the verified user for the inbox. */
export function createPostgresInboxApprovedTemplatesRepository(
  getVerifiedSession: AccountGuardDependencies['getVerifiedSession']
): {
  listForCurrentUser: () => Promise<InboxApprovedTemplate[]>;
} {
  const guards = createDefaultPostgresAccountGuards(getVerifiedSession);

  async function listForCurrentUser(): Promise<InboxApprovedTemplate[]> {
    const context = await guards.requireAccount();

    const result = await withTransaction(async (transaction) => {
      // Existing RLS policies resolve auth.uid() from this transaction-local GUC.
      await transaction.query(
        "SELECT set_config('request.jwt.claim.sub', $1, true)",
        [context.userId]
      );

      const query = await transaction.query<InboxApprovedTemplateRow>(
        `SELECT
           template.id::text AS id,
           template.name,
           template.category,
           template.language,
           template.header_type AS "headerType",
           template.header_content AS "headerContent",
           template.body_text AS "bodyText",
           template.footer_text AS "footerText",
           template.buttons
         FROM public.message_templates AS template
         INNER JOIN public.profiles AS creator
           ON creator.user_id = template.user_id
          AND creator.account_id = template.account_id
         WHERE template.account_id = $1
           AND template.user_id = $2
           AND template.status = 'APPROVED'
         ORDER BY template.created_at DESC, template.id DESC`,
        [context.accountId, context.userId]
      );

      return query.rows.map(toInboxApprovedTemplate);
    });

    if (!result.ok) throw result.error;
    return result.data;
  }

  return { listForCurrentUser };
}
