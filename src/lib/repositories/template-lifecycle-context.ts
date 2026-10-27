import 'server-only';

import type { QueryResultRow } from 'pg';
import type { AccountGuardDependencies } from '../auth/postgres-account-guard';
import { createDefaultPostgresAccountGuards } from '../auth/postgres-account-guard';
import { AppError } from '../db/errors';
import { withTransaction } from '../db/postgres-client';

export interface TemplateEditLifecycleContext {
  status: string;
  metaTemplateId: string | null;
}

export interface TemplateDeleteLifecycleContext {
  name: string;
  metaTemplateId: string | null;
}

interface TemplateLifecycleContextRow extends QueryResultRow {
  status: unknown;
  name: unknown;
  metaTemplateId: unknown;
}

type LifecycleRead = 'edit' | 'delete';

const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function templateId(value: unknown): string {
  if (typeof value !== 'string' || !uuidPattern.test(value)) {
    throw new AppError('bad_request');
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

/** Read only the fields consumed by a template lifecycle handler. */
export function createPostgresTemplateLifecycleContextRepository(
  getVerifiedSession: AccountGuardDependencies['getVerifiedSession']
): {
  getForEdit: (id: string) => Promise<TemplateEditLifecycleContext | null>;
  getForDelete: (id: string) => Promise<TemplateDeleteLifecycleContext | null>;
} {
  const guards = createDefaultPostgresAccountGuards(getVerifiedSession);

  async function findRow(
    id: string,
    purpose: LifecycleRead
  ): Promise<TemplateLifecycleContextRow | null> {
    const context = await guards.requireAccount();

    const result = await withTransaction(async (transaction) => {
      // Existing RLS policies resolve auth.uid() from this transaction-local GUC.
      await transaction.query(
        "SELECT set_config('request.jwt.claim.sub', $1, true)",
        [context.userId]
      );

      const columns =
        purpose === 'edit'
          ? 'template.status AS status, template.meta_template_id AS "metaTemplateId"'
          : 'template.name AS name, template.meta_template_id AS "metaTemplateId"';
      const sql =
        'SELECT ' +
        columns +
        ' FROM public.message_templates AS template' +
        ' WHERE template.id = $1 AND template.account_id = $2 LIMIT 2';
      const query = await transaction.query<TemplateLifecycleContextRow>(sql, [
        id,
        context.accountId,
      ]);

      if (query.rows.length > 1) throw new AppError('conflict');
      return query.rows[0] ?? null;
    });

    if (!result.ok) throw result.error;
    return result.data;
  }

  async function getForEdit(
    id: string
  ): Promise<TemplateEditLifecycleContext | null> {
    const row = await findRow(templateId(id), 'edit');
    if (row === null) return null;
    return {
      status: requiredString(row.status),
      metaTemplateId: nullableString(row.metaTemplateId),
    };
  }

  async function getForDelete(
    id: string
  ): Promise<TemplateDeleteLifecycleContext | null> {
    const row = await findRow(templateId(id), 'delete');
    if (row === null) return null;
    return {
      name: requiredString(row.name),
      metaTemplateId: nullableString(row.metaTemplateId),
    };
  }

  return { getForEdit, getForDelete };
}
