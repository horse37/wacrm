import 'server-only';

import type { QueryResultRow } from 'pg';
import type { AccountGuardDependencies } from '../auth/postgres-account-guard';
import { createDefaultPostgresAccountGuards } from '../auth/postgres-account-guard';
import { AppError } from '../db/errors';
import { withTransaction } from '../db/postgres-client';

export interface TemplateManagerCounts {
  total: number;
  pending: number;
}

interface TemplateManagerCountsRow extends QueryResultRow {
  totalCount: string | null;
  pendingCount: string | null;
}

function nonnegativeCount(value: unknown): number {
  if (typeof value !== 'string' || !/^(0|[1-9]\d*)$/.test(value)) {
    throw new AppError('db_error');
  }
  const count = Number(value);
  if (!Number.isSafeInteger(count) || count < 0) {
    throw new AppError('db_error');
  }
  return count;
}

function toTemplateManagerCounts(
  row: TemplateManagerCountsRow
): TemplateManagerCounts {
  const total = nonnegativeCount(row.totalCount);
  const pending = nonnegativeCount(row.pendingCount);
  if (pending > total) throw new AppError('db_error');
  return { total, pending };
}

/** Count all and pending templates owned by the verified user. */
export function createPostgresTemplateManagerCountsRepository(
  getVerifiedSession: AccountGuardDependencies['getVerifiedSession']
): { getForCurrentUser: () => Promise<TemplateManagerCounts> } {
  const guards = createDefaultPostgresAccountGuards(getVerifiedSession);

  async function getForCurrentUser(): Promise<TemplateManagerCounts> {
    const context = await guards.requireAccount();
    const result = await withTransaction(async (transaction) => {
      // Existing RLS policies resolve auth.uid() from this transaction-local GUC.
      await transaction.query(
        "SELECT set_config('request.jwt.claim.sub', $1, true)",
        [context.userId]
      );

      const query = await transaction.query<TemplateManagerCountsRow>(
        `SELECT
           COUNT(template.id)::text AS "totalCount",
           (COUNT(template.id) FILTER (
             WHERE template.status = 'PENDING'
           ))::text AS "pendingCount"
         FROM public.message_templates AS template
         INNER JOIN public.profiles AS creator
           ON creator.user_id = template.user_id
          AND creator.account_id = template.account_id
         WHERE template.account_id = $1
           AND template.user_id = $2`,
        [context.accountId, context.userId]
      );

      if (query.rows.length !== 1) throw new AppError('db_error');
      return toTemplateManagerCounts(query.rows[0]);
    });

    if (!result.ok) throw result.error;
    return result.data;
  }

  return { getForCurrentUser };
}
