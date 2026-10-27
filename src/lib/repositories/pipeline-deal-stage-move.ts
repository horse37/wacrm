import 'server-only';

import type { QueryResultRow } from 'pg';
import type { AccountGuardDependencies } from '../auth/postgres-account-guard';
import { createDefaultPostgresAccountGuards } from '../auth/postgres-account-guard';
import { AppError } from '../db/errors';
import { withTransaction } from '../db/postgres-client';

interface MovedDealRow extends QueryResultRow {
  id: string;
  stage_id: string;
}

function requestedUuid(value: unknown): string {
  if (
    typeof value !== 'string' ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
      value
    )
  ) {
    throw new AppError('bad_request');
  }
  return value.toLowerCase();
}

function returnedUuid(value: unknown): string {
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

/** Move one account deal to a stage owned by its current pipeline. */
export function createPostgresPipelineDealStageMoveRepository(
  getVerifiedSession: AccountGuardDependencies['getVerifiedSession']
): {
  moveToStage: (dealId: string, stageId: string) => Promise<void>;
} {
  const guards = createDefaultPostgresAccountGuards(getVerifiedSession);

  async function moveToStage(
    dealIdInput: string,
    stageIdInput: string
  ): Promise<void> {
    const context = await guards.requireRole('agent');
    const dealId = requestedUuid(dealIdInput);
    const stageId = requestedUuid(stageIdInput);

    const result = await withTransaction(async (transaction) => {
      // Existing RLS policies resolve auth.uid() from this transaction-local GUC.
      await transaction.query(
        "SELECT set_config('request.jwt.claim.sub', $1, true)",
        [context.userId]
      );

      const update = await transaction.query<MovedDealRow>(
        `UPDATE public.deals AS d
         SET stage_id = $3
         WHERE d.account_id = $1
           AND d.id = $2
           AND EXISTS (
             SELECT 1
             FROM public.pipelines AS p
             WHERE p.id = d.pipeline_id
               AND p.account_id = d.account_id
           )
           AND EXISTS (
             SELECT 1
             FROM public.pipeline_stages AS target_stage
             WHERE target_stage.id = $3
               AND target_stage.pipeline_id = d.pipeline_id
           )
         RETURNING d.id::text AS id, d.stage_id::text AS stage_id`,
        [context.accountId, dealId, stageId]
      );

      if (update.rows.length === 0) throw new AppError('not_found');
      if (update.rows.length !== 1) throw new AppError('conflict');
      const row = update.rows[0];
      if (
        returnedUuid(row.id) !== dealId ||
        returnedUuid(row.stage_id) !== stageId
      ) {
        throw new AppError('db_error');
      }
    });

    if (!result.ok) throw result.error;
  }

  return { moveToStage };
}
