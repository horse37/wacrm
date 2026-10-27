import 'server-only';

import { randomUUID } from 'node:crypto';
import type { QueryResultRow } from 'pg';
import {
  validateStepsForActivation,
  validateTriggerForActivation,
} from '../automations/validate';
import type { ValidationIssue } from '../automations/validate';
import type { AccountGuardDependencies } from '../auth/postgres-account-guard';
import { createDefaultPostgresAccountGuards } from '../auth/postgres-account-guard';
import { AppError } from '../db/errors';
import { withTransaction } from '../db/postgres-client';

interface AutomationRow extends QueryResultRow {
  id: unknown;
  user_id: unknown;
  account_id: unknown;
  name: unknown;
  description: unknown;
  trigger_type: unknown;
  trigger_config: unknown;
  is_active: unknown;
}

interface AutomationStepRow extends QueryResultRow {
  id: unknown;
  parent_step_id: unknown;
  branch: unknown;
  step_type: unknown;
  step_config: unknown;
  position: unknown;
}

interface ParsedStep {
  id?: string;
  stepType: string;
  stepConfig: Record<string, unknown>;
  branches: { yes: ParsedStep[]; no: ParsedStep[] };
}

interface ParsedPatch {
  fields: Partial<{
    name: string;
    description: string | null;
    trigger_type: string;
    trigger_config: Record<string, unknown>;
    is_active: boolean;
  }>;
  steps?: ParsedStep[];
}

interface StepInsertRow {
  id: string;
  automation_id: string;
  parent_step_id: string | null;
  branch: 'yes' | 'no' | null;
  step_type: string;
  step_config: Record<string, unknown>;
  position: number;
}

interface ActivationStep {
  step_type: string;
  step_config: Record<string, unknown>;
  branches: { yes: ActivationStep[]; no: ActivationStep[] };
}

const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const maxAutomationSteps = 500;
const maxAutomationDepth = 50;

export class AutomationActivationValidationError extends AppError {
  readonly issues: ValidationIssue[];

  constructor(issues: ValidationIssue[]) {
    super('bad_request');
    this.name = 'AutomationActivationValidationError';
    this.issues = issues;
  }
}

function recordObject(
  value: unknown,
  errorCode: 'bad_request' | 'db_error'
): Record<string, unknown> {
  if (
    typeof value !== 'object' ||
    value === null ||
    Array.isArray(value) ||
    (Object.getPrototypeOf(value) !== Object.prototype &&
      Object.getPrototypeOf(value) !== null)
  ) {
    throw new AppError(errorCode);
  }
  return value as Record<string, unknown>;
}

function plainObject(value: unknown): Record<string, unknown> {
  return recordObject(value, 'bad_request');
}

function databaseObject(value: unknown): Record<string, unknown> {
  return recordObject(value, 'db_error');
}

function uuidString(value: unknown, errorCode: 'bad_request' | 'db_error') {
  if (typeof value !== 'string' || !uuidPattern.test(value)) {
    throw new AppError(errorCode);
  }
  return value.toLowerCase();
}

function stepType(value: unknown, errorCode: 'bad_request' | 'db_error') {
  if (typeof value !== 'string' || value.length === 0) {
    throw new AppError(errorCode);
  }
  return value;
}

function stepConfig(value: unknown, errorCode: 'bad_request' | 'db_error') {
  if (value === undefined || value === null) return {};
  return recordObject(value, errorCode);
}

function parseTreeStep(
  value: unknown,
  depth: number,
  count: { value: number }
): ParsedStep {
  if (depth > maxAutomationDepth) throw new AppError('bad_request');
  count.value += 1;
  if (count.value > maxAutomationSteps) throw new AppError('bad_request');

  const input = plainObject(value);
  if (input.parent_index !== undefined || input.branch !== undefined) {
    throw new AppError('bad_request');
  }
  const parsed: ParsedStep = {
    id:
      input.id === undefined ? undefined : uuidString(input.id, 'bad_request'),
    stepType: stepType(input.step_type, 'bad_request'),
    stepConfig: stepConfig(input.step_config, 'bad_request'),
    branches: { yes: [], no: [] },
  };

  if (input.branches === undefined || input.branches === null) return parsed;
  if (parsed.stepType !== 'condition') throw new AppError('bad_request');
  const branches = plainObject(input.branches);
  if (
    Object.keys(branches).some((key) => key !== 'yes' && key !== 'no') ||
    (branches.yes !== undefined && !Array.isArray(branches.yes)) ||
    (branches.no !== undefined && !Array.isArray(branches.no))
  ) {
    throw new AppError('bad_request');
  }
  parsed.branches.yes = (branches.yes ?? []).map((child: unknown) =>
    parseTreeStep(child, depth + 1, count)
  );
  parsed.branches.no = (branches.no ?? []).map((child: unknown) =>
    parseTreeStep(child, depth + 1, count)
  );
  return parsed;
}

function parseFlatSteps(inputs: Record<string, unknown>[]): ParsedStep[] {
  if (inputs.length > maxAutomationSteps) throw new AppError('bad_request');
  const nodes = inputs.map((input) => ({
    step: {
      id:
        input.id === undefined
          ? undefined
          : uuidString(input.id, 'bad_request'),
      stepType: stepType(input.step_type, 'bad_request'),
      stepConfig: stepConfig(input.step_config, 'bad_request'),
      branches: { yes: [] as ParsedStep[], no: [] as ParsedStep[] },
    },
    branches: input.branches,
    parentIndex: input.parent_index,
    branch: input.branch,
  }));
  const roots: ParsedStep[] = [];

  for (const [index, node] of nodes.entries()) {
    if (node.branches !== undefined) throw new AppError('bad_request');
    if (node.parentIndex === undefined || node.parentIndex === null) {
      if (node.branch !== undefined && node.branch !== null) {
        throw new AppError('bad_request');
      }
      roots.push(node.step);
      continue;
    }
    if (
      typeof node.parentIndex !== 'number' ||
      !Number.isSafeInteger(node.parentIndex) ||
      node.parentIndex < 0 ||
      node.parentIndex >= nodes.length ||
      node.parentIndex === index
    ) {
      throw new AppError('bad_request');
    }
    const parent = nodes[node.parentIndex].step;
    if (parent.stepType !== 'condition') throw new AppError('bad_request');
    const branch = node.branch ?? 'yes';
    if (branch !== 'yes' && branch !== 'no') {
      throw new AppError('bad_request');
    }
    parent.branches[branch].push(node.step);
  }

  const visited = new Set<ParsedStep>();
  const pending = roots.map((step) => ({ step, depth: 0 }));
  while (pending.length > 0) {
    const current = pending.pop()!;
    if (current.depth > maxAutomationDepth || visited.has(current.step)) {
      throw new AppError('bad_request');
    }
    visited.add(current.step);
    for (const branch of ['yes', 'no'] as const) {
      for (const child of current.step.branches[branch]) {
        pending.push({ step: child, depth: current.depth + 1 });
      }
    }
  }
  if (visited.size !== nodes.length) throw new AppError('bad_request');
  return roots;
}

function parseSteps(value: unknown): ParsedStep[] {
  if (!Array.isArray(value) || value.length > maxAutomationSteps) {
    throw new AppError('bad_request');
  }
  const records = value.map(plainObject);
  const isFlat = records.some(
    (step) => step.parent_index !== undefined || step.branch !== undefined
  );
  const count = { value: 0 };
  const parsed = isFlat
    ? parseFlatSteps(records)
    : records.map((step) => parseTreeStep(step, 0, count));

  const ids = new Set<string>();
  function collect(nodes: ParsedStep[]) {
    for (const node of nodes) {
      if (node.id) {
        if (ids.has(node.id)) throw new AppError('bad_request');
        ids.add(node.id);
      }
      collect(node.branches.yes);
      collect(node.branches.no);
    }
  }
  collect(parsed);
  return parsed;
}

function parsePatch(value: unknown): ParsedPatch {
  const input = plainObject(value);
  const fields: ParsedPatch['fields'] = {};
  if (Object.hasOwn(input, 'name')) {
    if (typeof input.name !== 'string') throw new AppError('bad_request');
    fields.name = input.name;
  }
  if (Object.hasOwn(input, 'description')) {
    if (input.description !== null && typeof input.description !== 'string') {
      throw new AppError('bad_request');
    }
    fields.description = input.description as string | null;
  }
  if (Object.hasOwn(input, 'trigger_type')) {
    if (typeof input.trigger_type !== 'string')
      throw new AppError('bad_request');
    fields.trigger_type = input.trigger_type;
  }
  if (Object.hasOwn(input, 'trigger_config')) {
    fields.trigger_config = recordObject(input.trigger_config, 'bad_request');
  }
  if (Object.hasOwn(input, 'is_active')) {
    if (typeof input.is_active !== 'boolean') throw new AppError('bad_request');
    fields.is_active = input.is_active;
  }

  return {
    fields,
    ...(Array.isArray(input.steps) ? { steps: parseSteps(input.steps) } : {}),
  };
}

function parseAutomation(
  row: AutomationRow,
  expected: {
    automationId: string;
    userId: string;
    accountId: string;
  }
) {
  const id = uuidString(row.id, 'db_error');
  const userId = uuidString(row.user_id, 'db_error');
  const accountId = uuidString(row.account_id, 'db_error');
  if (
    id !== expected.automationId ||
    userId !== expected.userId.toLowerCase() ||
    accountId !== expected.accountId.toLowerCase() ||
    typeof row.name !== 'string' ||
    (row.description !== null && typeof row.description !== 'string') ||
    typeof row.trigger_type !== 'string' ||
    typeof row.is_active !== 'boolean'
  ) {
    throw new AppError('db_error');
  }
  return {
    triggerType: row.trigger_type,
    triggerConfig: databaseObject(row.trigger_config),
    isActive: row.is_active,
  };
}

function parseDatabaseSteps(rows: AutomationStepRow[]): ParsedStep[] {
  if (rows.length > maxAutomationSteps) throw new AppError('db_error');
  const nodes = new Map<string, ParsedStep>();
  const links: {
    id: string;
    parentId: string | null;
    branch: 'yes' | 'no' | null;
    position: number;
  }[] = [];

  for (const row of rows) {
    const id = uuidString(row.id, 'db_error');
    const parentId =
      row.parent_step_id === null
        ? null
        : uuidString(row.parent_step_id, 'db_error');
    const branch = row.branch;
    const parsedBranch = branch === 'yes' || branch === 'no' ? branch : null;
    if (
      (parentId === null && branch !== null) ||
      (parentId !== null && branch !== 'yes' && branch !== 'no') ||
      typeof row.position !== 'number' ||
      !Number.isSafeInteger(row.position) ||
      row.position < 0 ||
      nodes.has(id)
    ) {
      throw new AppError('db_error');
    }
    nodes.set(id, {
      id,
      stepType: stepType(row.step_type, 'db_error'),
      stepConfig: databaseObject(row.step_config),
      branches: { yes: [], no: [] },
    });
    links.push({ id, parentId, branch: parsedBranch, position: row.position });
  }

  const roots: ParsedStep[] = [];
  for (const link of links) {
    const node = nodes.get(link.id)!;
    if (link.parentId === null) {
      roots.push(node);
      continue;
    }
    const parent = nodes.get(link.parentId);
    if (!parent || parent.stepType !== 'condition') {
      throw new AppError('db_error');
    }
    parent.branches[link.branch as 'yes' | 'no'].push(node);
  }

  const visited = new Set<string>();
  const pending = roots.map((step) => ({ step, depth: 0 }));
  while (pending.length > 0) {
    const current = pending.pop()!;
    const id = current.step.id;
    if (current.depth > maxAutomationDepth || !id || visited.has(id)) {
      throw new AppError('db_error');
    }
    visited.add(id);
    pending.push(
      ...current.step.branches.yes.map((step) => ({
        step,
        depth: current.depth + 1,
      })),
      ...current.step.branches.no.map((step) => ({
        step,
        depth: current.depth + 1,
      }))
    );
  }
  if (visited.size !== nodes.size) throw new AppError('db_error');

  // SQL returns siblings by position and ID. Re-sort each scope to keep the
  // builder order deterministic even when the database contains tied positions.
  const positionById = new Map(links.map((link) => [link.id, link.position]));
  const sortScope = (scope: ParsedStep[]) => {
    scope.sort((left, right) => {
      const positionDifference =
        positionById.get(left.id!)! - positionById.get(right.id!)!;
      return positionDifference || left.id!.localeCompare(right.id!);
    });
    for (const step of scope) {
      sortScope(step.branches.yes);
      sortScope(step.branches.no);
    }
  };
  sortScope(roots);
  return roots;
}

function activationSteps(steps: ParsedStep[]): ActivationStep[] {
  return steps.map((step) => ({
    step_type: step.stepType,
    step_config: step.stepConfig,
    branches: {
      yes: activationSteps(step.branches.yes),
      no: activationSteps(step.branches.no),
    },
  }));
}

function insertRows(
  steps: ParsedStep[],
  automationId: string,
  generateId: () => string
): StepInsertRow[] {
  const usedIds = new Set<string>([automationId]);
  const rows: StepInsertRow[] = [];
  const append = (
    nodes: ParsedStep[],
    parentId: string | null,
    branch: 'yes' | 'no' | null
  ) => {
    nodes.forEach((step, position) => {
      const id = uuidString(step.id ?? generateId(), 'db_error');
      if (usedIds.has(id)) throw new AppError('bad_request');
      usedIds.add(id);
      rows.push({
        id,
        automation_id: automationId,
        parent_step_id: parentId,
        branch,
        step_type: step.stepType,
        step_config: step.stepConfig,
        position,
      });
      append(step.branches.yes, id, 'yes');
      append(step.branches.no, id, 'no');
    });
  };
  append(steps, null, null);
  return rows;
}

/** Atomically patch a verified-account automation and, optionally, its builder steps. */
export function createPostgresAutomationUpdatePersistenceRepository(
  getVerifiedSession: AccountGuardDependencies['getVerifiedSession'],
  generateId: () => string = randomUUID
): {
  patchOwnedAutomation: (
    automationId: unknown,
    patch: unknown
  ) => Promise<void>;
} {
  const guards = createDefaultPostgresAccountGuards(getVerifiedSession);

  async function patchOwnedAutomation(
    automationIdValue: unknown,
    patchValue: unknown
  ): Promise<void> {
    const context = await guards.requireRole('agent');
    const automationId = uuidString(automationIdValue, 'bad_request');
    const patch = parsePatch(patchValue);

    const result = await withTransaction(async (transaction) => {
      await transaction.query(
        "SELECT set_config('request.jwt.claim.sub', $1, true)",
        [context.userId]
      );
      const selected = await transaction.query<AutomationRow>(
        `SELECT
           automation.id::text AS id,
           automation.user_id::text AS user_id,
           automation.account_id::text AS account_id,
           automation.name,
           automation.description,
           automation.trigger_type,
           automation.trigger_config,
           automation.is_active
         FROM public.automations AS automation
         WHERE automation.id = $1
           AND automation.user_id = $2
           AND automation.account_id = $3
         FOR UPDATE OF automation`,
        [automationId, context.userId, context.accountId]
      );
      if (selected.rows.length === 0) throw new AppError('not_found');
      if (selected.rows.length !== 1) throw new AppError('conflict');
      const existing = parseAutomation(selected.rows[0], {
        automationId,
        userId: context.userId,
        accountId: context.accountId,
      });
      const willBeActive =
        typeof patch.fields.is_active === 'boolean'
          ? patch.fields.is_active
          : existing.isActive;

      let steps = patch.steps;
      if (willBeActive) {
        if (steps === undefined) {
          const selectedSteps = await transaction.query<AutomationStepRow>(
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
            [automationId]
          );
          steps = parseDatabaseSteps(selectedSteps.rows);
        }
        const issues = [
          ...validateTriggerForActivation(
            patch.fields.trigger_type ?? existing.triggerType,
            patch.fields.trigger_config ?? existing.triggerConfig
          ),
          ...validateStepsForActivation(activationSteps(steps)),
        ];
        if (issues.length > 0)
          throw new AutomationActivationValidationError(issues);
      }

      const entries = Object.entries(patch.fields) as [
        keyof ParsedPatch['fields'],
        string | boolean | null | Record<string, unknown>,
      ][];
      if (entries.length > 0) {
        const values: unknown[] = [];
        const assignments = entries.map(([field, value]) => {
          values.push(
            field === 'trigger_config' ? JSON.stringify(value) : value
          );
          const placeholder = `$${values.length}`;
          return field === 'trigger_config'
            ? `${field} = ${placeholder}::jsonb`
            : `${field} = ${placeholder}`;
        });
        values.push(automationId, context.userId, context.accountId);
        const idIndex = values.length - 2;
        const updated = await transaction.query<{ id: unknown }>(
          `UPDATE public.automations AS automation
           SET ${assignments.join(', ')}
           WHERE automation.id = $${idIndex}
             AND automation.user_id = $${idIndex + 1}
             AND automation.account_id = $${idIndex + 2}
           RETURNING automation.id::text AS id`,
          values
        );
        if (updated.rows.length !== 1) {
          throw new AppError(
            updated.rows.length === 0 ? 'not_found' : 'conflict'
          );
        }
        if (uuidString(updated.rows[0].id, 'db_error') !== automationId) {
          throw new AppError('db_error');
        }
      }

      if (patch.steps !== undefined) {
        const deleted = await transaction.query<{ id: unknown }>(
          `DELETE FROM public.automation_steps AS step
           WHERE step.automation_id = $1
           RETURNING step.id::text AS id`,
          [automationId]
        );
        for (const row of deleted.rows) uuidString(row.id, 'db_error');

        const rows = insertRows(patch.steps, automationId, generateId);
        if (rows.length > 0) {
          const inserted = await transaction.query<{ id: unknown }>(
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
            [JSON.stringify(rows)]
          );
          const insertedIds = new Set(
            inserted.rows.map((row) => uuidString(row.id, 'db_error'))
          );
          if (
            inserted.rows.length !== rows.length ||
            rows.some((row) => !insertedIds.has(row.id))
          ) {
            throw new AppError('db_error');
          }
        }
      }
    });

    if (!result.ok) throw result.error;
  }

  return { patchOwnedAutomation };
}
