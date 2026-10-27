import 'server-only';

import { randomUUID } from 'node:crypto';
import type { QueryResultRow } from 'pg';
import type { AccountGuardDependencies } from '../auth/postgres-account-guard';
import { createDefaultPostgresAccountGuards } from '../auth/postgres-account-guard';
import { AppError } from '../db/errors';
import { withTransaction } from '../db/postgres-client';

export interface DuplicatedAutomation {
  id: string;
  user_id: string;
  account_id: string;
  name: string;
  description: string | null;
  trigger_type: string;
  trigger_config: Record<string, unknown>;
  is_active: false;
  execution_count: 0;
  last_executed_at: null;
  created_at: string;
  updated_at: string;
}

interface SourceAutomationRow extends QueryResultRow {
  id: unknown;
  user_id: unknown;
  account_id: unknown;
  name: unknown;
  description: unknown;
  trigger_type: unknown;
  trigger_config: unknown;
}

interface SourceAutomationStepRow extends QueryResultRow {
  id: unknown;
  parent_step_id: unknown;
  branch: unknown;
  step_type: unknown;
  step_config: unknown;
  position: unknown;
}

interface CreatedAutomationRow extends QueryResultRow {
  id: unknown;
  user_id: unknown;
  account_id: unknown;
  name: unknown;
  description: unknown;
  trigger_type: unknown;
  trigger_config: unknown;
  is_active: unknown;
  execution_count: unknown;
  last_executed_at: unknown;
  created_at: unknown;
  updated_at: unknown;
}

interface ParsedSourceAutomation {
  id: string;
  userId: string;
  accountId: string;
  name: string;
  description: string | null;
  triggerType: string;
  triggerConfig: Record<string, unknown>;
}

interface ParsedSourceStep {
  id: string;
  parentStepId: string | null;
  branch: 'yes' | 'no' | null;
  stepType: string;
  stepConfig: Record<string, unknown>;
  position: number;
}

interface DuplicatedStep {
  id: string;
  automation_id: string;
  parent_step_id: string | null;
  branch: 'yes' | 'no' | null;
  step_type: string;
  step_config: Record<string, unknown>;
  position: number;
}

const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function uuidString(value: unknown): string {
  if (typeof value !== 'string' || !uuidPattern.test(value)) {
    throw new AppError('db_error');
  }
  return value.toLowerCase();
}

function requestedUuid(value: unknown): string {
  if (typeof value !== 'string' || !uuidPattern.test(value)) {
    throw new AppError('bad_request');
  }
  return value.toLowerCase();
}

function plainObject(value: unknown): Record<string, unknown> {
  if (
    typeof value !== 'object' ||
    value === null ||
    Array.isArray(value) ||
    (Object.getPrototypeOf(value) !== Object.prototype &&
      Object.getPrototypeOf(value) !== null)
  ) {
    throw new AppError('db_error');
  }
  return value as Record<string, unknown>;
}

function nullableString(value: unknown): string | null {
  if (value === null) return null;
  if (typeof value !== 'string') throw new AppError('db_error');
  return value;
}

function branchValue(value: unknown): ParsedSourceStep['branch'] {
  if (value === null || value === 'yes' || value === 'no') return value;
  throw new AppError('db_error');
}

function timestamp(value: unknown): string {
  const date =
    value instanceof Date
      ? value
      : typeof value === 'string'
        ? new Date(value)
        : null;
  if (!date || Number.isNaN(date.getTime())) throw new AppError('db_error');
  return date.toISOString();
}

function parseSourceAutomation(
  row: SourceAutomationRow,
  expectedUserId: string,
  expectedAccountId: string
): ParsedSourceAutomation {
  const id = uuidString(row.id);
  const userId = uuidString(row.user_id);
  const accountId = uuidString(row.account_id);
  if (
    userId !== expectedUserId.toLowerCase() ||
    accountId !== expectedAccountId.toLowerCase()
  ) {
    throw new AppError('db_error');
  }
  if (typeof row.name !== 'string' || typeof row.trigger_type !== 'string') {
    throw new AppError('db_error');
  }
  return {
    id,
    userId,
    accountId,
    name: row.name,
    description: nullableString(row.description),
    triggerType: row.trigger_type,
    triggerConfig: plainObject(row.trigger_config),
  };
}

function parseSourceSteps(rows: SourceAutomationStepRow[]): ParsedSourceStep[] {
  const parsed = rows.map((row) => {
    const parentStepId =
      row.parent_step_id === null ? null : uuidString(row.parent_step_id);
    const branch = branchValue(row.branch);
    if (
      typeof row.step_type !== 'string' ||
      row.step_type.length === 0 ||
      typeof row.position !== 'number' ||
      !Number.isSafeInteger(row.position)
    ) {
      throw new AppError('db_error');
    }
    return {
      id: uuidString(row.id),
      parentStepId,
      branch,
      stepType: row.step_type,
      stepConfig: plainObject(row.step_config),
      position: row.position,
    };
  });

  const byId = new Map<string, ParsedSourceStep>();
  const childrenByParent = new Map<string, ParsedSourceStep[]>();
  for (const step of parsed) {
    if (byId.has(step.id)) throw new AppError('db_error');
    byId.set(step.id, step);
  }

  const roots: ParsedSourceStep[] = [];
  for (const step of parsed) {
    if (step.parentStepId === null) {
      if (step.branch !== null) throw new AppError('db_error');
      roots.push(step);
      continue;
    }

    const parent = byId.get(step.parentStepId);
    if (!parent || parent.stepType !== 'condition') {
      throw new AppError('db_error');
    }
    const children = childrenByParent.get(parent.id) ?? [];
    children.push(step);
    childrenByParent.set(parent.id, children);
  }

  const visited = new Set<string>();
  const pending = [...roots];
  while (pending.length > 0) {
    const step = pending.pop()!;
    if (visited.has(step.id)) throw new AppError('db_error');
    visited.add(step.id);
    pending.push(...(childrenByParent.get(step.id) ?? []));
  }
  if (visited.size !== parsed.length) throw new AppError('db_error');

  return parsed;
}

function copiedSteps(
  sourceSteps: ParsedSourceStep[],
  copyAutomationId: string,
  generateId: () => string
): DuplicatedStep[] {
  const usedIds = new Set([
    copyAutomationId,
    ...sourceSteps.map((step) => step.id),
  ]);
  const idMap = new Map<string, string>();

  for (const step of sourceSteps) {
    const newId = uuidString(generateId());
    if (usedIds.has(newId)) throw new AppError('db_error');
    usedIds.add(newId);
    idMap.set(step.id, newId);
  }

  return sourceSteps.map((step) => {
    const newParentId =
      step.parentStepId === null ? null : idMap.get(step.parentStepId);
    if (step.parentStepId !== null && !newParentId) {
      throw new AppError('db_error');
    }
    return {
      id: idMap.get(step.id)!,
      automation_id: copyAutomationId,
      parent_step_id: newParentId ?? null,
      branch: step.branch,
      step_type: step.stepType,
      step_config: step.stepConfig,
      position: step.position,
    };
  });
}

function duplicatedAutomation(
  row: CreatedAutomationRow,
  expected: {
    id: string;
    userId: string;
    accountId: string;
    name: string;
    description: string | null;
    triggerType: string;
    triggerConfig: Record<string, unknown>;
  }
): DuplicatedAutomation {
  const id = uuidString(row.id);
  const userId = uuidString(row.user_id);
  const accountId = uuidString(row.account_id);
  if (
    id !== expected.id ||
    userId !== expected.userId ||
    accountId !== expected.accountId ||
    row.name !== expected.name ||
    row.description !== expected.description ||
    row.trigger_type !== expected.triggerType ||
    JSON.stringify(plainObject(row.trigger_config)) !==
      JSON.stringify(expected.triggerConfig) ||
    row.is_active !== false ||
    row.execution_count !== 0 ||
    row.last_executed_at !== null
  ) {
    throw new AppError('db_error');
  }
  return {
    id,
    user_id: userId,
    account_id: accountId,
    name: expected.name,
    description: expected.description,
    trigger_type: expected.triggerType,
    trigger_config: expected.triggerConfig,
    is_active: false,
    execution_count: 0,
    last_executed_at: null,
    created_at: timestamp(row.created_at),
    updated_at: timestamp(row.updated_at),
  };
}

/** Duplicate a verified user's automation and its graph atomically in PostgreSQL. */
export function createPostgresAutomationDuplicatePersistenceRepository(
  getVerifiedSession: AccountGuardDependencies['getVerifiedSession'],
  generateId: () => string = randomUUID
): {
  duplicateOwnedAutomation: (
    sourceAutomationId: string
  ) => Promise<DuplicatedAutomation>;
} {
  const guards = createDefaultPostgresAccountGuards(getVerifiedSession);

  async function duplicateOwnedAutomation(
    sourceAutomationIdInput: string
  ): Promise<DuplicatedAutomation> {
    const context = await guards.requireRole('agent');
    const sourceAutomationId = requestedUuid(sourceAutomationIdInput);

    const result = await withTransaction(async (transaction) => {
      // A repeatable-read snapshot keeps parent and step reads consistent
      // without granting UPDATE solely to acquire a row lock.
      await transaction.query(
        'SET TRANSACTION ISOLATION LEVEL REPEATABLE READ'
      );

      // Existing RLS policies resolve auth.uid() from this transaction-local GUC.
      await transaction.query(
        "SELECT set_config('request.jwt.claim.sub', $1, true)",
        [context.userId]
      );

      const sourceQuery = await transaction.query<SourceAutomationRow>(
        `SELECT
           automation.id::text AS id,
           automation.user_id::text AS user_id,
           automation.account_id::text AS account_id,
           automation.name,
           automation.description,
           automation.trigger_type,
           automation.trigger_config
         FROM public.automations AS automation
         INNER JOIN public.profiles AS creator
           ON creator.user_id = automation.user_id
          AND creator.account_id = automation.account_id
         WHERE automation.account_id = $1
           AND automation.id = $2
           AND automation.user_id = $3
         LIMIT 2
         `,
        [context.accountId, sourceAutomationId, context.userId]
      );
      if (sourceQuery.rows.length === 0) throw new AppError('not_found');
      if (sourceQuery.rows.length !== 1) throw new AppError('conflict');

      const source = parseSourceAutomation(
        sourceQuery.rows[0],
        context.userId,
        context.accountId
      );
      if (source.id !== sourceAutomationId) throw new AppError('db_error');

      const sourceStepsQuery = await transaction.query<SourceAutomationStepRow>(
        `SELECT
           step.id::text AS id,
           step.parent_step_id::text AS parent_step_id,
           step.branch,
           step.step_type,
           step.step_config,
           step.position
         FROM public.automation_steps AS step
         WHERE step.automation_id = $1
         ORDER BY step.position ASC, step.id ASC`,
        [source.id]
      );
      const sourceSteps = parseSourceSteps(sourceStepsQuery.rows);

      const copyId = uuidString(generateId());
      if (
        copyId === source.id ||
        sourceSteps.some((step) => step.id === copyId)
      ) {
        throw new AppError('db_error');
      }
      const stepCopies = copiedSteps(sourceSteps, copyId, generateId);
      const copyName = `${source.name} (Copy)`;
      const copied = await transaction.query<CreatedAutomationRow>(
        `INSERT INTO public.automations (
           id, user_id, account_id, name, description, trigger_type,
           trigger_config, is_active
         ) VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, false)
         RETURNING
           id::text AS id,
           user_id::text AS user_id,
           account_id::text AS account_id,
           name,
           description,
           trigger_type,
           trigger_config,
           is_active,
           execution_count,
           last_executed_at,
           created_at,
           updated_at`,
        [
          copyId,
          context.userId,
          context.accountId,
          copyName,
          source.description,
          source.triggerType,
          JSON.stringify(source.triggerConfig),
        ]
      );
      if (copied.rows.length !== 1) throw new AppError('db_error');
      const automation = duplicatedAutomation(copied.rows[0], {
        id: copyId,
        userId: context.userId.toLowerCase(),
        accountId: context.accountId.toLowerCase(),
        name: copyName,
        description: source.description,
        triggerType: source.triggerType,
        triggerConfig: source.triggerConfig,
      });

      if (stepCopies.length > 0) {
        const insertedSteps = await transaction.query<{ id: unknown }>(
          `INSERT INTO public.automation_steps (
             id, automation_id, parent_step_id, branch, step_type,
             step_config, position
           )
           SELECT
             copied.id,
             copied.automation_id,
             copied.parent_step_id,
             copied.branch,
             copied.step_type,
             copied.step_config,
             copied.position
           FROM jsonb_to_recordset($1::jsonb) AS copied(
             id uuid,
             automation_id uuid,
             parent_step_id uuid,
             branch text,
             step_type text,
             step_config jsonb,
             position integer
           )
           RETURNING id::text AS id`,
          [JSON.stringify(stepCopies)]
        );
        const insertedIds = insertedSteps.rows.map((row) => uuidString(row.id));
        if (
          insertedSteps.rowCount !== stepCopies.length ||
          insertedIds.length !== stepCopies.length ||
          new Set(insertedIds).size !== stepCopies.length ||
          stepCopies.some((step) => !insertedIds.includes(step.id))
        ) {
          throw new AppError('db_error');
        }
      }

      return automation;
    });

    if (!result.ok) throw result.error;
    return result.data;
  }

  return { duplicateOwnedAutomation };
}
