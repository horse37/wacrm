import 'server-only';

import type { QueryResultRow } from 'pg';
import type { AccountGuardDependencies } from '../auth/postgres-account-guard';
import { createDefaultPostgresAccountGuards } from '../auth/postgres-account-guard';
import { AppError } from '../db/errors';
import { withTransaction } from '../db/postgres-client';

export interface AutomationEditorStep {
  id: string;
  step_type: string;
  step_config: Record<string, unknown>;
  branches: { yes: AutomationEditorStep[]; no: AutomationEditorStep[] };
}

export interface AutomationEditorAutomation {
  id: string;
  name: string;
  description: string | null;
  trigger_type: string;
  trigger_config: Record<string, unknown>;
  is_active: boolean;
}

export interface AutomationEditorData {
  automation: AutomationEditorAutomation;
  steps: AutomationEditorStep[];
}

interface AutomationEditorRow extends QueryResultRow {
  id: string | null;
  name: string | null;
  description: string | null;
  trigger_type: string | null;
  trigger_config: unknown;
  is_active: boolean | null;
  creator_user_id: string | null;
}

interface AutomationStepRow extends QueryResultRow {
  id: string | null;
  parent_step_id: string | null;
  branch: string | null;
  step_type: string | null;
  step_config: unknown;
  position: number | null;
}

interface ParsedAutomationStep {
  id: string;
  parentStepId: string | null;
  branch: 'yes' | 'no' | null;
  stepType: string;
  position: number;
  node: AutomationEditorStep;
}

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

function requestedUuid(value: unknown): string {
  try {
    return uuidString(value);
  } catch {
    throw new AppError('bad_request');
  }
}

function requiredString(value: unknown): string {
  if (typeof value !== 'string') throw new AppError('db_error');
  return value;
}

function requiredNonEmptyString(value: unknown): string {
  const result = requiredString(value);
  if (result.length === 0) throw new AppError('db_error');
  return result;
}

function optionalString(value: unknown): string | null {
  if (value === null) return null;
  return requiredString(value);
}

function booleanValue(value: unknown): boolean {
  if (typeof value !== 'boolean') throw new AppError('db_error');
  return value;
}

function jsonObject(value: unknown): Record<string, unknown> {
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

function nonNegativePosition(value: unknown): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) {
    throw new AppError('db_error');
  }
  return value;
}

function parseBranch(value: unknown): 'yes' | 'no' | null {
  if (value === null || value === 'yes' || value === 'no') return value;
  throw new AppError('db_error');
}

function toAutomationEditorAutomation(
  row: AutomationEditorRow,
  expectedCreatorUserId: string
): AutomationEditorAutomation {
  if (uuidString(row.creator_user_id) !== expectedCreatorUserId) {
    throw new AppError('db_error');
  }
  return {
    id: uuidString(row.id),
    name: requiredString(row.name),
    description: optionalString(row.description),
    trigger_type: requiredNonEmptyString(row.trigger_type),
    trigger_config: jsonObject(row.trigger_config),
    is_active: booleanValue(row.is_active),
  };
}

function toAutomationEditorStep(row: AutomationStepRow): ParsedAutomationStep {
  return {
    id: uuidString(row.id),
    parentStepId:
      row.parent_step_id === null ? null : uuidString(row.parent_step_id),
    branch: parseBranch(row.branch),
    stepType: requiredNonEmptyString(row.step_type),
    position: nonNegativePosition(row.position),
    node: {
      id: uuidString(row.id),
      step_type: requiredNonEmptyString(row.step_type),
      step_config: jsonObject(row.step_config),
      branches: { yes: [], no: [] },
    },
  };
}

function compareSteps(
  a: ParsedAutomationStep,
  b: ParsedAutomationStep
): number {
  return a.position - b.position || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
}

function buildStepTree(rows: AutomationStepRow[]): AutomationEditorStep[] {
  const parsed = rows.map(toAutomationEditorStep).sort(compareSteps);
  const byId = new Map<string, ParsedAutomationStep>();
  const childrenByParent = new Map<string, ParsedAutomationStep[]>();

  for (const step of parsed) {
    if (byId.has(step.id)) throw new AppError('db_error');
    byId.set(step.id, step);
  }

  const roots: AutomationEditorStep[] = [];
  for (const step of parsed) {
    if (step.parentStepId === null) {
      if (step.branch !== null) throw new AppError('db_error');
      roots.push(step.node);
      continue;
    }

    const parent = byId.get(step.parentStepId);
    if (!parent || parent.stepType !== 'condition') {
      throw new AppError('db_error');
    }

    // Older rows may omit branch; the existing editor loader treated those as yes.
    const branch = step.branch ?? 'yes';
    parent.node.branches[branch].push(step.node);
    const children = childrenByParent.get(parent.id) ?? [];
    children.push(step);
    childrenByParent.set(parent.id, children);
  }

  const visited = new Set<string>();
  const pending = [...parsed.filter((step) => step.parentStepId === null)];
  while (pending.length > 0) {
    const step = pending.pop()!;
    if (visited.has(step.id)) throw new AppError('db_error');
    visited.add(step.id);
    pending.push(...(childrenByParent.get(step.id) ?? []));
  }
  if (visited.size !== parsed.length) throw new AppError('db_error');

  return roots;
}

/** Load the editor-safe automation fields and nested steps in the verified account. */
export function createPostgresAutomationEditorRepository(
  getVerifiedSession: AccountGuardDependencies['getVerifiedSession']
): {
  getForAutomation: (automationId: string) => Promise<AutomationEditorData>;
} {
  const guards = createDefaultPostgresAccountGuards(getVerifiedSession);

  async function getForAutomation(
    automationIdInput: string
  ): Promise<AutomationEditorData> {
    const context = await guards.requireAccount();
    const automationId = requestedUuid(automationIdInput);

    const result = await withTransaction(async (transaction) => {
      // Existing RLS policies resolve auth.uid() from this transaction-local GUC.
      await transaction.query(
        "SELECT set_config('request.jwt.claim.sub', $1, true)",
        [context.userId]
      );

      const automationQuery = await transaction.query<AutomationEditorRow>(
        `SELECT
           a.id::text AS id,
           a.name,
           a.description,
           a.trigger_type,
           a.trigger_config,
           a.is_active,
           a.user_id::text AS creator_user_id
         FROM public.automations AS a
         INNER JOIN public.profiles AS creator
           ON creator.user_id = a.user_id
          AND creator.account_id = a.account_id
         WHERE a.account_id = $1
           AND a.id = $2
           AND a.user_id = $3
         LIMIT 2`,
        [context.accountId, automationId, context.userId]
      );

      if (automationQuery.rows.length === 0) throw new AppError('not_found');
      if (automationQuery.rows.length !== 1) throw new AppError('conflict');

      const automation = toAutomationEditorAutomation(
        automationQuery.rows[0],
        context.userId
      );

      const stepsQuery = await transaction.query<AutomationStepRow>(
        `SELECT
           s.id::text AS id,
           s.parent_step_id::text AS parent_step_id,
           s.branch,
           s.step_type,
           s.step_config,
           s.position
         FROM public.automation_steps AS s
         INNER JOIN public.automations AS a
           ON a.id = s.automation_id
         INNER JOIN public.profiles AS creator
           ON creator.user_id = a.user_id
          AND creator.account_id = a.account_id
         WHERE s.automation_id = $1
           AND a.id = $1
           AND a.account_id = $2
         ORDER BY s.position ASC, s.id ASC`,
        [automationId, context.accountId]
      );

      return {
        automation,
        steps: buildStepTree(stepsQuery.rows),
      };
    });

    if (!result.ok) throw result.error;
    return result.data;
  }

  return { getForAutomation };
}
