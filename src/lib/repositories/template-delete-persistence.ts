import 'server-only';

import type { QueryResultRow } from 'pg';
import type { AccountGuardDependencies } from '../auth/postgres-account-guard';
import { createDefaultPostgresAccountGuards } from '../auth/postgres-account-guard';
import { AppError } from '../db/errors';
import { withTransaction } from '../db/postgres-client';

interface DeletedTemplateRow extends QueryResultRow {
  id: unknown;
}

const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function requestedUuid(value: unknown): string {
  if (typeof value !== 'string' || !uuidPattern.test(value)) {
    throw new AppError('bad_request');
  }
  return value.toLowerCase();
}

function returnedUuid(value: unknown): string {
  if (typeof value !== 'string' || !uuidPattern.test(value)) {
    throw new AppError('db_error');
  }
  return value.toLowerCase();
}

/** Delete one template only after the caller has completed provider work. */
export function createPostgresTemplateDeletePersistenceRepository(
  getVerifiedSession: AccountGuardDependencies['getVerifiedSession']
): {
  deleteTemplate: (templateId: string) => Promise<void>;
} {
  const guards = createDefaultPostgresAccountGuards(getVerifiedSession);

  async function deleteTemplate(templateIdInput: string): Promise<void> {
    const context = await guards.requireRole('admin');
    const templateId = requestedUuid(templateIdInput);

    const result = await withTransaction(async (transaction) => {
      // Existing RLS policies resolve auth.uid() from this transaction-local GUC.
      await transaction.query(
        "SELECT set_config('request.jwt.claim.sub', $1, true)",
        [context.userId]
      );

      const deletion = await transaction.query<DeletedTemplateRow>(
        `DELETE FROM public.message_templates AS template
         WHERE template.account_id = $1
           AND template.id = $2
         RETURNING template.id::text AS id`,
        [context.accountId, templateId]
      );

      if (deletion.rows.length === 0) throw new AppError('not_found');
      if (deletion.rows.length !== 1) throw new AppError('conflict');
      if (returnedUuid(deletion.rows[0].id) !== templateId) {
        throw new AppError('db_error');
      }
    });

    if (!result.ok) throw result.error;
  }

  return { deleteTemplate };
}
