import 'server-only';

import { randomUUID } from 'node:crypto';
import type { QueryResultRow } from 'pg';
import {
  validateStepsForActivation,
  validateTriggerForActivation,
} from '../automations/validate';
import type { AccountGuardDependencies } from '../auth/postgres-account-guard';
import { createDefaultPostgresAccountGuards } from '../auth/postgres-account-guard';
import { AppError } from '../db/errors';
import { withTransaction } from '../db/postgres-client';

export interface CreatedAutomation {
  id: string;
  user_id: string;
  account_id: string;
  name: string;
  description: string | null;
  trigger_type: string;
  trigger_config: Record<string, unknown>;
  is_active: boolean;
  execution_count: 0;
  last_executed_at: null;
  created_at: string;
  updated_at: string;
}

interface AutomationCreateRow extends QueryResultRow {
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

interface ParsedStep {
  stepType: string;
  stepConfig: Record<string, unknown>;
  branches: { yes: ParsedStep[]; no: ParsedStep[] };
}

interface ActivationStep {
  step_type: string;
  step_config: Record<string, unknown>;
  branches: { yes: ActivationStep[]; no: ActivationStep[] };
}

interface AutomationStepInsert {
  id: string;
  automation_id: string;
  parent_step_id: string | null;
  branch: 'yes' | 'no' | null;
  step_type: string;
  step_config: Record<string, unknown>;
  position: number;
}

interface ParsedAutomationCreate {
  name: string;
  description: string | null;
  triggerType: string;
  triggerConfig: Record<string, unknown>;
  isActive: boolean;
  steps: ParsedStep[];
}

const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const maxAutomationSteps = 500;
const maxAutomationDepth = 50;

function badRequest(): never {
  throw new AppError('bad_request');
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

function objectOrEmpty(value: unknown): Record<string, unknown> {
  if (value === undefined || value === null) return {};
  return plainObject(value);
}

function requiredName(value: unknown): string {
  if (typeof value !== 'string' || value.length === 0) return badRequest();
  return value;
}

function requiredTriggerType(value: unknown): string {
  if (typeof value !== 'string' || value.length === 0) return badRequest();
  return value;
}

function nullableDescription(value: unknown): string | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== 'string') return badRequest();
  return value;
}

function parseTreeStep(
  value: unknown,
  depth: number,
  count: { value: number }
): ParsedStep {
  if (depth > maxAutomationDepth) return badRequest();
  count.value += 1;
  if (count.value > maxAutomationSteps) return badRequest();

  const input = plainObject(value);
  if (input.parent_index !== undefined || input.branch !== undefined) {
    return badRequest();
  }
  const stepType = requiredTriggerType(input.step_type);
  const stepConfig = objectOrEmpty(input.step_config);
  const parsed: ParsedStep = {
    stepType,
    stepConfig,
    branches: { yes: [], no: [] },
  };

  if (input.branches === undefined || input.branches === null) return parsed;
  if (stepType !== 'condition') return badRequest();

  const branches = plainObject(input.branches);
  if (
    Object.keys(branches).some((key) => key !== 'yes' && key !== 'no') ||
    (branches.yes !== undefined && !Array.isArray(branches.yes)) ||
    (branches.no !== undefined && !Array.isArray(branches.no))
  ) {
    return badRequest();
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
  if (inputs.length > maxAutomationSteps) return badRequest();

  const nodes = inputs.map((input) => ({
    step: {
      stepType: requiredTriggerType(input.step_type),
      stepConfig: objectOrEmpty(input.step_config),
      branches: { yes: [] as ParsedStep[], no: [] as ParsedStep[] },
    },
    branches: input.branches,
    parentIndex: input.parent_index,
    branch: input.branch,
  }));

  const roots: ParsedStep[] = [];
  for (const [index, node] of nodes.entries()) {
    if (node.branches !== undefined) return badRequest();
    const parentIndex = node.parentIndex;
    if (parentIndex === undefined || parentIndex === null) {
      if (node.branch !== undefined && node.branch !== null)
        return badRequest();
      roots.push(node.step);
      continue;
    }
    if (
      typeof parentIndex !== 'number' ||
      !Number.isSafeInteger(parentIndex) ||
      parentIndex < 0 ||
      parentIndex >= nodes.length ||
      parentIndex === index
    ) {
      return badRequest();
    }
    const parent = nodes[parentIndex].step;
    if (parent.stepType !== 'condition') return badRequest();

    const branch = node.branch ?? 'yes';
    if (branch !== 'yes' && branch !== 'no') return badRequest();
    parent.branches[branch].push(node.step);
  }

  const visited = new Set<ParsedStep>();
  const pending = roots.map((step) => ({ step, depth: 0 }));
  while (pending.length > 0) {
    const current = pending.pop()!;
    if (current.depth > maxAutomationDepth || visited.has(current.step)) {
      return badRequest();
    }
    visited.add(current.step);
    for (const branch of ['yes', 'no'] as const) {
      for (const child of current.step.branches[branch]) {
        pending.push({ step: child, depth: current.depth + 1 });
      }
    }
  }
  if (visited.size !== nodes.length) return badRequest();
  return roots;
}

function parseSteps(value: unknown): ParsedStep[] {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value) || value.length > maxAutomationSteps) {
    return badRequest();
  }
  const records = value.map(plainObject);
  const isFlat = records.some(
    (step) => step.parent_index !== undefined || step.branch !== undefined
  );
  if (isFlat) return parseFlatSteps(records);

  const count = { value: 0 };
  return records.map((step) => parseTreeStep(step, 0, count));
}

function parseAutomationCreate(value: unknown): ParsedAutomationCreate {
  const input = plainObject(value);
  const name = requiredName(input.name);
  const description = nullableDescription(input.description);
  const triggerType = requiredTriggerType(input.trigger_type);
  const triggerConfig = objectOrEmpty(input.trigger_config);
  const isActive = Boolean(input.is_active);
  const steps = parseSteps(input.steps);

  if (isActive) {
    const toActivationSteps = (nodes: ParsedStep[]): ActivationStep[] =>
      nodes.map((step) => ({
        step_type: step.stepType,
        step_config: step.stepConfig,
        branches: {
          yes: toActivationSteps(step.branches.yes),
          no: toActivationSteps(step.branches.no),
        },
      }));
    const tree = toActivationSteps(steps);
    const issues = [
      ...validateTriggerForActivation(triggerType, triggerConfig),
      ...validateStepsForActivation(tree),
    ];
    if (issues.length > 0) return badRequest();
  }

  return { name, description, triggerType, triggerConfig, isActive, steps };
}

function uuidString(value: unknown): string {
  if (typeof value !== 'string' || !uuidPattern.test(value)) {
    throw new AppError('db_error');
  }
  return value.toLowerCase();
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

function stableJson(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map((entry) => stableJson(entry)).join(',')}]`;
  }
  if (typeof value === 'object' && value !== null) {
    const object = databaseObject(value);
    return `{${Object.keys(object)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableJson(object[key])}`)
      .join(',')}}`;
  }
  const serialized = JSON.stringify(value);
  if (serialized === undefined) throw new AppError('db_error');
  return serialized;
}

function createdAutomation(
  row: AutomationCreateRow,
  expected: {
    id: string;
    userId: string;
    accountId: string;
    input: ParsedAutomationCreate;
  }
): CreatedAutomation {
  const id = uuidString(row.id);
  const userId = uuidString(row.user_id);
  const accountId = uuidString(row.account_id);
  const triggerConfig = databaseObject(row.trigger_config);
  if (
    id !== expected.id ||
    userId !== expected.userId.toLowerCase() ||
    accountId !== expected.accountId.toLowerCase() ||
    row.name !== expected.input.name ||
    row.description !== expected.input.description ||
    row.trigger_type !== expected.input.triggerType ||
    stableJson(triggerConfig) !== stableJson(expected.input.triggerConfig) ||
    row.is_active !== expected.input.isActive ||
    row.execution_count !== 0 ||
    row.last_executed_at !== null
  ) {
    throw new AppError('db_error');
  }

  return {
    id,
    user_id: userId,
    account_id: accountId,
    name: expected.input.name,
    description: expected.input.description,
    trigger_type: expected.input.triggerType,
    trigger_config: expected.input.triggerConfig,
    is_active: expected.input.isActive,
    execution_count: 0,
    last_executed_at: null,
    created_at: timestamp(row.created_at),
    updated_at: timestamp(row.updated_at),
  };
}

function automationSteps(
  steps: ParsedStep[],
  automationId: string,
  generateId: () => string
): AutomationStepInsert[] {
  const rows: AutomationStepInsert[] = [];
  const usedIds = new Set<string>([automationId]);

  function append(
    nodes: ParsedStep[],
    parentId: string | null,
    branch: 'yes' | 'no' | null
  ): void {
    nodes.forEach((step, position) => {
      const id = uuidString(generateId());
      if (usedIds.has(id)) throw new AppError('db_error');
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
      if (step.stepType === 'condition') {
        append(step.branches.yes, id, 'yes');
        append(step.branches.no, id, 'no');
      }
    });
  }

  append(steps, null, null);
  return rows;
}

/** Atomically create a verified-account automation and its builder steps in PostgreSQL. */
export function createPostgresAutomationCreatePersistenceRepository(
  getVerifiedSession: AccountGuardDependencies['getVerifiedSession'],
  generateId: () => string = randomUUID
): {
  createAutomation: (input: unknown) => Promise<CreatedAutomation>;
} {
  const guards = createDefaultPostgresAccountGuards(getVerifiedSession);

  async function createAutomation(
    inputValue: unknown
  ): Promise<CreatedAutomation> {
    const context = await guards.requireRole('agent');
    const input = parseAutomationCreate(inputValue);
    const id = uuidString(generateId());
    const steps = automationSteps(input.steps, id, generateId);

    const result = await withTransaction(async (transaction) => {
      await transaction.query(
        "SELECT set_config('request.jwt.claim.sub', $1, true)",
        [context.userId]
      );

      const inserted = await transaction.query<AutomationCreateRow>(
        `INSERT INTO public.automations (
           id, user_id, account_id, name, description, trigger_type,
           trigger_config, is_active
         ) VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8)
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
          id,
          context.userId,
          context.accountId,
          input.name,
          input.description,
          input.triggerType,
          JSON.stringify(input.triggerConfig),
          input.isActive,
        ]
      );
      if (inserted.rows.length !== 1) throw new AppError('db_error');
      const automation = createdAutomation(inserted.rows[0], {
        id,
        userId: context.userId,
        accountId: context.accountId,
        input,
      });

      if (steps.length > 0) {
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
          [JSON.stringify(steps)]
        );
        const insertedIds = new Set(
          insertedSteps.rows.map((row) => uuidString(row.id))
        );
        if (
          insertedSteps.rows.length !== steps.length ||
          steps.some((step) => !insertedIds.has(step.id))
        ) {
          throw new AppError('db_error');
        }
      }

      return automation;
    });

    if (!result.ok) throw result.error;
    return result.data;
  }

  return { createAutomation };
}
