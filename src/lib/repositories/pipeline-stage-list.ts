import 'server-only';

import type { QueryResultRow } from 'pg';
import type { PipelineStage } from '../../types';
import type { AccountGuardDependencies } from '../auth/postgres-account-guard';
import { createDefaultPostgresAccountGuards } from '../auth/postgres-account-guard';
import { AppError } from '../db/errors';
import { withTransaction } from '../db/postgres-client';

interface PipelineStageListRow extends QueryResultRow {
  id: string | null;
  pipeline_id: string | null;
  pipeline_account_id: string | null;
  name: string | null;
  position: number | null;
  color: string | null;
  created_at: Date | string | null;
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

function integerValue(value: unknown): number {
  if (typeof value !== 'number' || !Number.isInteger(value)) {
    throw new AppError('db_error');
  }
  return value;
}

function timestampString(value: Date | string): string {
  const date = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(date.getTime())) throw new AppError('db_error');
  return date.toISOString();
}

function toPipelineStage(
  row: PipelineStageListRow,
  accountId: string,
  pipelineId: string
): PipelineStage {
  const id = uuidString(row.id);
  const rowPipelineId = uuidString(row.pipeline_id);
  const pipelineAccountId = uuidString(row.pipeline_account_id);
  if (
    rowPipelineId !== pipelineId.toLowerCase() ||
    pipelineAccountId !== accountId.toLowerCase()
  ) {
    throw new AppError('db_error');
  }

  return {
    id,
    pipeline_id: rowPipelineId,
    name: requiredString(row.name),
    position: integerValue(row.position),
    color: requiredString(row.color),
    created_at:
      row.created_at === null ? null : timestampString(row.created_at),
  };
}

/** List stages of a pipeline in the verified account in stable board order. */
export function createPostgresPipelineStageListRepository(
  getVerifiedSession: AccountGuardDependencies['getVerifiedSession']
): { listForPipeline: (pipelineId: string) => Promise<PipelineStage[]> } {
  const guards = createDefaultPostgresAccountGuards(getVerifiedSession);

  async function listForPipeline(
    pipelineIdInput: string
  ): Promise<PipelineStage[]> {
    const context = await guards.requireAccount();
    const pipelineId = requestedUuid(pipelineIdInput);

    const result = await withTransaction(async (transaction) => {
      // Existing RLS policies resolve auth.uid() from this transaction-local GUC.
      await transaction.query(
        "SELECT set_config('request.jwt.claim.sub', $1, true)",
        [context.userId]
      );

      const query = await transaction.query<PipelineStageListRow>(
        `SELECT
           ps.id::text AS id,
           ps.pipeline_id::text AS pipeline_id,
           p.account_id::text AS pipeline_account_id,
           ps.name,
           ps.position,
           ps.color,
           ps.created_at
         FROM public.pipeline_stages AS ps
         INNER JOIN public.pipelines AS p
           ON p.id = ps.pipeline_id
         WHERE p.account_id = $1
           AND p.id = $2
         ORDER BY ps.position ASC, ps.id ASC`,
        [context.accountId, pipelineId]
      );

      return query.rows.map((row) =>
        toPipelineStage(row, context.accountId, pipelineId)
      );
    });

    if (!result.ok) throw result.error;
    return result.data;
  }

  return { listForPipeline };
}
