import 'server-only';

import type { QueryResultRow } from 'pg';
import type { AccountGuardDependencies } from '../auth/postgres-account-guard';
import { createDefaultPostgresAccountGuards } from '../auth/postgres-account-guard';
import { AppError } from '../db/errors';
import { withTransaction } from '../db/postgres-client';

export type TemplateCategory = 'Marketing' | 'Utility' | 'Authentication';

export interface ApprovedBroadcastTemplate {
  id: string;
  name: string;
  category: TemplateCategory;
  language: string | null;
  body_text: string;
}

interface ApprovedBroadcastTemplateRow extends QueryResultRow {
  id: string | null;
  name: string | null;
  category: string | null;
  language: string | null;
  body_text: string | null;
}

const templateCategories = new Set<TemplateCategory>([
  'Marketing',
  'Utility',
  'Authentication',
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

function templateCategory(value: unknown): TemplateCategory {
  if (
    typeof value !== 'string' ||
    !templateCategories.has(value as TemplateCategory)
  ) {
    throw new AppError('db_error');
  }
  return value as TemplateCategory;
}

function optionalString(value: unknown): string | null {
  if (value !== null && typeof value !== 'string') {
    throw new AppError('db_error');
  }
  return value;
}

function toApprovedBroadcastTemplate(
  row: ApprovedBroadcastTemplateRow
): ApprovedBroadcastTemplate {
  return {
    id: uuidString(row.id),
    name: requiredString(row.name),
    category: templateCategory(row.category),
    language: optionalString(row.language),
    body_text: requiredString(row.body_text),
  };
}

/** List validated approved-template card fields visible to the verified account. */
export function createPostgresApprovedBroadcastTemplateRepository(
  getVerifiedSession: AccountGuardDependencies['getVerifiedSession']
): { listForCurrentAccount: () => Promise<ApprovedBroadcastTemplate[]> } {
  const guards = createDefaultPostgresAccountGuards(getVerifiedSession);

  async function listForCurrentAccount(): Promise<ApprovedBroadcastTemplate[]> {
    const context = await guards.requireAccount();

    const result = await withTransaction(async (transaction) => {
      // Existing RLS policies resolve auth.uid() from this transaction-local GUC.
      await transaction.query(
        "SELECT set_config('request.jwt.claim.sub', $1, true)",
        [context.userId]
      );

      const query = await transaction.query<ApprovedBroadcastTemplateRow>(
        `SELECT
           template.id::text AS id,
           template.name,
           template.category,
           template.language,
           template.body_text
         FROM public.message_templates AS template
         WHERE template.account_id = $1
           AND template.status = 'APPROVED'
         ORDER BY template.created_at DESC, template.id DESC`,
        [context.accountId]
      );

      return query.rows.map(toApprovedBroadcastTemplate);
    });

    if (!result.ok) throw result.error;
    return result.data;
  }

  return { listForCurrentAccount };
}
