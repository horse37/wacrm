import 'server-only';

import type { QueryResultRow } from 'pg';
import type { MessageTemplateStatus } from '../../types';
import type { AccountGuardDependencies } from '../auth/postgres-account-guard';
import { createDefaultPostgresAccountGuards } from '../auth/postgres-account-guard';
import { AppError } from '../db/errors';
import { withTransaction } from '../db/postgres-client';

export type TemplateManagerCategory =
  | 'Marketing'
  | 'Utility'
  | 'Authentication';
export type TemplateQualityScore = 'GREEN' | 'YELLOW' | 'RED';

export interface TemplateManagerCatalogItem {
  id: string;
  name: string;
  category: TemplateManagerCategory;
  status: MessageTemplateStatus | null;
  language: string | null;
  quality_score: TemplateQualityScore | null;
  body_text: string;
  footer_text: string | null;
  rejection_reason: string | null;
  submission_error: string | null;
  meta_template_id: string | null;
}

interface TemplateManagerCatalogRow extends QueryResultRow {
  id: string | null;
  name: string | null;
  category: string | null;
  status: string | null;
  language: string | null;
  quality_score: string | null;
  body_text: string | null;
  footer_text: string | null;
  rejection_reason: string | null;
  submission_error: string | null;
  meta_template_id: string | null;
}

const templateCategories = new Set<TemplateManagerCategory>([
  'Marketing',
  'Utility',
  'Authentication',
]);
const templateStatuses = new Set<MessageTemplateStatus>([
  'DRAFT',
  'PENDING',
  'APPROVED',
  'REJECTED',
  'PAUSED',
  'DISABLED',
  'IN_APPEAL',
  'PENDING_DELETION',
]);
const templateQualityScores = new Set<TemplateQualityScore>([
  'GREEN',
  'YELLOW',
  'RED',
]);

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

function templateCategory(value: unknown): TemplateManagerCategory {
  if (
    typeof value !== 'string' ||
    !templateCategories.has(value as TemplateManagerCategory)
  ) {
    throw new AppError('db_error');
  }
  return value as TemplateManagerCategory;
}

function templateStatus(value: unknown): MessageTemplateStatus | null {
  if (value === null) return null;
  if (
    typeof value !== 'string' ||
    !templateStatuses.has(value as MessageTemplateStatus)
  ) {
    throw new AppError('db_error');
  }
  return value as MessageTemplateStatus;
}

function templateQualityScore(value: unknown): TemplateQualityScore | null {
  if (value === null) return null;
  if (
    typeof value !== 'string' ||
    !templateQualityScores.has(value as TemplateQualityScore)
  ) {
    throw new AppError('db_error');
  }
  return value as TemplateQualityScore;
}

function toTemplateManagerCatalogItem(
  row: TemplateManagerCatalogRow
): TemplateManagerCatalogItem {
  return {
    id: uuidString(row.id),
    name: requiredString(row.name),
    category: templateCategory(row.category),
    status: templateStatus(row.status),
    language: nullableString(row.language),
    quality_score: templateQualityScore(row.quality_score),
    body_text: requiredString(row.body_text),
    footer_text: nullableString(row.footer_text),
    rejection_reason: nullableString(row.rejection_reason),
    submission_error: nullableString(row.submission_error),
    meta_template_id: nullableString(row.meta_template_id),
  };
}

/** List validated template-manager card fields for the verified user. */
export function createPostgresTemplateManagerCatalogRepository(
  getVerifiedSession: AccountGuardDependencies['getVerifiedSession']
): { listForCurrentUser: () => Promise<TemplateManagerCatalogItem[]> } {
  const guards = createDefaultPostgresAccountGuards(getVerifiedSession);

  async function listForCurrentUser(): Promise<TemplateManagerCatalogItem[]> {
    const context = await guards.requireAccount();

    const result = await withTransaction(async (transaction) => {
      // Existing RLS policies resolve auth.uid() from this transaction-local GUC.
      await transaction.query(
        "SELECT set_config('request.jwt.claim.sub', $1, true)",
        [context.userId]
      );

      const query = await transaction.query<TemplateManagerCatalogRow>(
        `SELECT
           template.id::text AS id,
           template.name,
           template.category,
           template.status,
           template.language,
           template.quality_score,
           template.body_text,
           template.footer_text,
           template.rejection_reason,
           template.submission_error,
           template.meta_template_id
         FROM public.message_templates AS template
         INNER JOIN public.profiles AS creator
           ON creator.user_id = template.user_id
          AND creator.account_id = template.account_id
         WHERE template.account_id = $1
           AND template.user_id = $2
         ORDER BY template.created_at DESC, template.id DESC`,
        [context.accountId, context.userId]
      );

      return query.rows.map(toTemplateManagerCatalogItem);
    });

    if (!result.ok) throw result.error;
    return result.data;
  }

  return { listForCurrentUser };
}
