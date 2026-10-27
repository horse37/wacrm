import 'server-only';

import type { QueryResultRow } from 'pg';
import type { AccountGuardDependencies } from '../auth/postgres-account-guard';
import { createDefaultPostgresAccountGuards } from '../auth/postgres-account-guard';
import { AppError } from '../db/errors';
import { withTransaction } from '../db/postgres-client';

export interface TemplateLifecycleEditConfig {
  encryptedAccessToken: string;
}

export interface TemplateLifecycleDeleteConfig {
  encryptedAccessToken: string;
  wabaId: string | null;
}

interface TemplateLifecycleConfigRow extends QueryResultRow {
  encryptedAccessToken: unknown;
  wabaId?: unknown;
}

type LifecycleConfigRead = 'edit' | 'delete';

function encryptedAccessToken(value: unknown): string {
  if (typeof value !== 'string' || value.length === 0) {
    throw new AppError('db_error');
  }
  return value;
}

function nullableWabaId(value: unknown): string | null {
  if (value !== null && typeof value !== 'string') {
    throw new AppError('db_error');
  }
  return value;
}

/** Read only opaque credential context required by template lifecycle handlers. */
export function createPostgresTemplateLifecycleConfigRepository(
  getVerifiedSession: AccountGuardDependencies['getVerifiedSession']
): {
  getForEdit: () => Promise<TemplateLifecycleEditConfig | null>;
  getForDelete: () => Promise<TemplateLifecycleDeleteConfig | null>;
} {
  const guards = createDefaultPostgresAccountGuards(getVerifiedSession);

  async function findConfig(
    purpose: LifecycleConfigRead
  ): Promise<TemplateLifecycleConfigRow | null> {
    const context = await guards.requireAccount();

    const result = await withTransaction(async (transaction) => {
      // Existing RLS policies resolve auth.uid() from this transaction-local GUC.
      await transaction.query(
        "SELECT set_config('request.jwt.claim.sub', $1, true)",
        [context.userId]
      );

      const sql =
        purpose === 'edit'
          ? 'SELECT access_token AS "encryptedAccessToken" FROM public.whatsapp_config WHERE account_id = $1 LIMIT 2'
          : 'SELECT access_token AS "encryptedAccessToken", waba_id AS "wabaId" FROM public.whatsapp_config WHERE account_id = $1 LIMIT 2';
      const query = await transaction.query<TemplateLifecycleConfigRow>(sql, [
        context.accountId,
      ]);

      if (query.rows.length > 1) throw new AppError('conflict');
      return query.rows[0] ?? null;
    });

    if (!result.ok) throw result.error;
    return result.data;
  }

  async function getForEdit(): Promise<TemplateLifecycleEditConfig | null> {
    const row = await findConfig('edit');
    if (row === null) return null;
    return {
      encryptedAccessToken: encryptedAccessToken(row.encryptedAccessToken),
    };
  }

  async function getForDelete(): Promise<TemplateLifecycleDeleteConfig | null> {
    const row = await findConfig('delete');
    if (row === null) return null;
    return {
      encryptedAccessToken: encryptedAccessToken(row.encryptedAccessToken),
      wabaId: nullableWabaId(row.wabaId),
    };
  }

  return { getForEdit, getForDelete };
}
