import 'server-only';

import type { QueryResultRow } from 'pg';
import type { AccountGuardDependencies } from '../auth/postgres-account-guard';
import { createDefaultPostgresAccountGuards } from '../auth/postgres-account-guard';
import { AppError } from '../db/errors';
import { withTransaction } from '../db/postgres-client';

export interface ApprovedAutomationTemplateOption {
  id: string;
  name: string;
  language: string | null;
}

interface ApprovedAutomationTemplateRow extends QueryResultRow {
  id: string | null;
  name: string | null;
  language: string | null;
}

const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function toApprovedAutomationTemplateOption(
  row: ApprovedAutomationTemplateRow
): ApprovedAutomationTemplateOption {
  if (typeof row.id !== 'string' || !uuidPattern.test(row.id)) {
    throw new AppError('db_error');
  }
  if (typeof row.name !== 'string') throw new AppError('db_error');
  if (row.language !== null && typeof row.language !== 'string') {
    throw new AppError('db_error');
  }

  return {
    id: row.id.toLowerCase(),
    name: row.name,
    language: row.language,
  };
}

/** List minimal approved template options for the verified account. */
export function createPostgresApprovedAutomationTemplatesRepository(
  getVerifiedSession: AccountGuardDependencies['getVerifiedSession']
): {
  listForCurrentAccount: () => Promise<ApprovedAutomationTemplateOption[]>;
} {
  const guards = createDefaultPostgresAccountGuards(getVerifiedSession);

  async function listForCurrentAccount(): Promise<
    ApprovedAutomationTemplateOption[]
  > {
    const context = await guards.requireAccount();
    const result = await withTransaction(async (transaction) => {
      // Existing RLS policies resolve auth.uid() from this transaction-local GUC.
      await transaction.query(
        "SELECT set_config('request.jwt.claim.sub', $1, true)",
        [context.userId]
      );

      const query = await transaction.query<ApprovedAutomationTemplateRow>(
        `SELECT
           template.id::text AS id,
           template.name,
           template.language
         FROM public.message_templates AS template
         WHERE template.account_id = $1
           AND template.status = 'APPROVED'
         ORDER BY template.name ASC, template.id ASC`,
        [context.accountId]
      );

      return query.rows.map(toApprovedAutomationTemplateOption);
    });

    if (!result.ok) throw result.error;
    return result.data;
  }

  return { listForCurrentAccount };
}
