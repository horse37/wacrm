import 'server-only';

import type { QueryResultRow } from 'pg';
import type { AccountGuardDependencies } from '../auth/postgres-account-guard';
import { createDefaultPostgresAccountGuards } from '../auth/postgres-account-guard';
import { AppError } from '../db/errors';
import { withTransaction } from '../db/postgres-client';

interface TemplateSyncMatchRow extends QueryResultRow {
  id: unknown;
}

const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function templateId(value: unknown): string {
  if (typeof value !== 'string' || !uuidPattern.test(value)) {
    throw new AppError('db_error');
  }
  return value.toLowerCase();
}

/** Find a local template ID matching one provider-supplied sync definition. */
export function createPostgresTemplateSyncMatchRepository(
  getVerifiedSession: AccountGuardDependencies['getVerifiedSession']
): {
  findExistingId: (input: {
    name: string;
    language: string;
  }) => Promise<string | null>;
} {
  const guards = createDefaultPostgresAccountGuards(getVerifiedSession);

  async function findExistingId(input: {
    name: string;
    language: string;
  }): Promise<string | null> {
    if (
      typeof input?.name !== 'string' ||
      input.name.trim().length === 0 ||
      typeof input.language !== 'string' ||
      input.language.trim().length === 0
    ) {
      throw new AppError('bad_request');
    }

    const context = await guards.requireAccount();
    const result = await withTransaction(async (transaction) => {
      // Existing RLS policies resolve auth.uid() from this transaction-local GUC.
      await transaction.query(
        "SELECT set_config('request.jwt.claim.sub', $1, true)",
        [context.userId]
      );

      const query = await transaction.query<TemplateSyncMatchRow>(
        `SELECT template.id::text AS id
         FROM public.message_templates AS template
         WHERE template.account_id = $1
           AND template.name = $2
           AND template.language = $3
         LIMIT 2`,
        [context.accountId, input.name, input.language]
      );

      if (query.rows.length > 1) throw new AppError('conflict');
      if (query.rows.length === 0) return null;
      return templateId(query.rows[0].id);
    });

    if (!result.ok) throw result.error;
    return result.data;
  }

  return { findExistingId };
}
