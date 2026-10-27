import 'server-only';

import type { QueryResultRow } from 'pg';

import { withTransaction } from '../db/postgres-client';

interface BooleanResultRow extends QueryResultRow {
  result: unknown;
}

type ZapLeadHealthFailureCode = 'health_request_failed' | 'invalid_credentials';

const healthSuccessQuery =
  'SELECT public.record_zap_lead_health_success(' +
  '$1::uuid, $2::text, $3::timestamptz' +
  ') AS result';
const healthFailureQuery =
  'SELECT public.record_zap_lead_health_failure(' +
  '$1::uuid, $2::text, $3::text, $4::timestamptz' +
  ') AS result';
const heartbeatAlertQuery =
  'SELECT public.claim_zap_lead_heartbeat_alert(' +
  '$1::uuid, $2::text, $3::timestamptz' +
  ') AS result';

async function callHeartbeatFunction(
  query: string,
  values: readonly unknown[],
  errorMessage: string
): Promise<boolean> {
  const result = await withTransaction((transaction) =>
    transaction.query<BooleanResultRow>(query, values)
  );

  if (!result.ok || typeof result.data.rows[0]?.result !== 'boolean') {
    throw new Error(errorMessage);
  }

  return result.data.rows[0].result;
}

export function recordZapLeadHealthSuccess(
  accountId: string,
  keyId: string,
  checkedAt: Date
): Promise<boolean> {
  return callHeartbeatFunction(
    healthSuccessQuery,
    [accountId, keyId, checkedAt.toISOString()],
    'Could not persist Zap Lead health success'
  );
}

export function recordZapLeadHealthFailure(
  accountId: string,
  keyId: string,
  errorCode: ZapLeadHealthFailureCode,
  failedAt: Date
): Promise<boolean> {
  return callHeartbeatFunction(
    healthFailureQuery,
    [accountId, keyId, errorCode, failedAt.toISOString()],
    'Could not persist Zap Lead health failure'
  );
}

export function claimZapLeadHeartbeatAlert(
  accountId: string,
  keyId: string,
  now: Date
): Promise<boolean> {
  return callHeartbeatFunction(
    heartbeatAlertQuery,
    [accountId, keyId, now.toISOString()],
    'Could not claim Zap Lead heartbeat alert'
  );
}
