import 'server-only';

import type { QueryResultRow } from 'pg';
import type { AccountGuardDependencies } from '../auth/postgres-account-guard';
import { createDefaultPostgresAccountGuards } from '../auth/postgres-account-guard';
import { AppError } from '../db/errors';
import { withTransaction } from '../db/postgres-client';

export type FlowHeaderPatch = {
  name?: string;
  description?: string | null;
  trigger_type?: 'keyword' | 'first_inbound_message' | 'manual';
  trigger_config?: Record<string, unknown>;
  entry_node_id?: string | null;
  fallback_policy?: Record<string, unknown>;
};

interface UpdatedFlowRow extends QueryResultRow {
  id: unknown;
}

type HeaderField = keyof FlowHeaderPatch;
type ValidatedValue = string | null;

const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const headerFields: readonly HeaderField[] = [
  'name',
  'description',
  'trigger_type',
  'trigger_config',
  'entry_node_id',
  'fallback_policy',
];

const jsonFields = new Set<HeaderField>(['trigger_config', 'fallback_policy']);

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

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return (
    typeof value === 'object' &&
    value !== null &&
    !Array.isArray(value) &&
    (Object.getPrototypeOf(value) === Object.prototype ||
      Object.getPrototypeOf(value) === null)
  );
}

function jsonValue(value: unknown): string {
  if (!isPlainObject(value)) throw new AppError('bad_request');

  try {
    const serialized = JSON.stringify(value);
    if (typeof serialized !== 'string') throw new AppError('bad_request');
    return serialized;
  } catch {
    throw new AppError('bad_request');
  }
}

function validatedPatch(value: unknown): Map<HeaderField, ValidatedValue> {
  if (!isPlainObject(value)) throw new AppError('bad_request');

  const allowed = new Set<string>(headerFields);
  if (
    Reflect.ownKeys(value).some(
      (key) => typeof key !== 'string' || !allowed.has(key)
    )
  ) {
    throw new AppError('bad_request');
  }

  const patch = value as FlowHeaderPatch;
  const result = new Map<HeaderField, ValidatedValue>();

  for (const field of headerFields) {
    if (!Object.hasOwn(patch, field) || patch[field] === undefined) continue;
    const fieldValue: unknown = patch[field];

    switch (field) {
      case 'name':
        if (typeof fieldValue !== 'string' || fieldValue.trim().length === 0) {
          throw new AppError('bad_request');
        }
        result.set(field, fieldValue.trim());
        break;
      case 'description':
        if (fieldValue !== null && typeof fieldValue !== 'string') {
          throw new AppError('bad_request');
        }
        result.set(field, fieldValue);
        break;
      case 'trigger_type':
        if (
          fieldValue !== 'keyword' &&
          fieldValue !== 'first_inbound_message' &&
          fieldValue !== 'manual'
        ) {
          throw new AppError('bad_request');
        }
        result.set(field, fieldValue);
        break;
      case 'trigger_config':
      case 'fallback_policy':
        result.set(field, jsonValue(fieldValue));
        break;
      case 'entry_node_id':
        if (fieldValue !== null && typeof fieldValue !== 'string') {
          throw new AppError('bad_request');
        }
        result.set(field, fieldValue);
        break;
    }
  }

  return result;
}

/** Update only allowlisted flow-editor header fields within the verified account. */
export function createPostgresFlowHeaderUpdateRepository(
  getVerifiedSession: AccountGuardDependencies['getVerifiedSession']
): {
  updateForFlow: (flowId: string, patch: FlowHeaderPatch) => Promise<void>;
} {
  const guards = createDefaultPostgresAccountGuards(getVerifiedSession);

  async function updateForFlow(
    flowIdInput: string,
    patchInput: FlowHeaderPatch
  ): Promise<void> {
    const context = await guards.requireRole('agent');
    const flowId = requestedUuid(flowIdInput);
    const patch = validatedPatch(patchInput);

    const result = await withTransaction(async (transaction) => {
      // Existing RLS policies resolve auth.uid() from this transaction-local GUC.
      await transaction.query(
        "SELECT set_config('request.jwt.claim.sub', $1, true)",
        [context.userId]
      );

      const values: unknown[] = [flowId, context.accountId];
      const assignments: string[] = [];
      for (const field of headerFields) {
        if (!patch.has(field)) continue;
        const column = field;
        const placeholder = `$${values.length + 1}`;
        assignments.push(
          `${column} = ${placeholder}${jsonFields.has(field) ? '::jsonb' : ''}`
        );
        values.push(patch.get(field));
      }
      assignments.push('updated_at = NOW()');

      const update = await transaction.query<UpdatedFlowRow>(
        `UPDATE public.flows AS flow
         SET ${assignments.join(', ')}
         WHERE flow.id = $1
           AND flow.account_id = $2
         RETURNING flow.id::text AS id`,
        values
      );

      if (update.rows.length === 0) throw new AppError('not_found');
      if (update.rows.length !== 1) throw new AppError('conflict');
      if (returnedUuid(update.rows[0].id) !== flowId) {
        throw new AppError('db_error');
      }
    });

    if (!result.ok) throw result.error;
  }

  return { updateForFlow };
}
