import { getZapLeadReadClientForCurrentAccount } from './credentials';
import {
  appendZapLeadDashboardFilters,
  type ZapLeadDashboardFilters,
} from './dashboard-filters';

const periods = [7, 30, 90] as const;
const maxMatrixCells = 132;

export interface ZapLeadAnalysisMatrixData {
  status: 'empty' | 'pending' | 'ready';
  completedAt: string | null;
  totalAnalyzed: number;
  matrix: Array<{
    leadScore: number;
    serviceScore: number | null;
    count: number;
    goodLeadCount: number;
    percentage: number;
  }>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isUuid(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    /^[\da-f]{8}-[\da-f]{4}-[1-8][\da-f]{3}-[89ab][\da-f]{3}-[\da-f]{12}$/i.test(
      value
    )
  );
}

function buildRange(days: number, now: Date) {
  if (!periods.includes(days as (typeof periods)[number])) {
    throw new Error('Unsupported Zap Lead analysis period');
  }
  if (!Number.isFinite(now.getTime())) {
    throw new Error('Invalid date for Zap Lead analysis period');
  }

  const start = Date.UTC(
    now.getUTCFullYear(),
    now.getUTCMonth(),
    now.getUTCDate() - days + 1
  );
  const end = Date.UTC(
    now.getUTCFullYear(),
    now.getUTCMonth(),
    now.getUTCDate()
  );
  return {
    from: new Date(start).toISOString(),
    to: new Date(end + 24 * 60 * 60 * 1000 - 1).toISOString(),
  };
}

function parseRunList(
  value: unknown
): { id: string; completedAt: string | null } | null {
  if (
    !isRecord(value) ||
    typeof value.apiVersion !== 'string' ||
    !isRecord(value.data)
  ) {
    throw new Error('Zap Lead returned an invalid analyses response');
  }
  const items = value.data.items;
  if (!Array.isArray(items) || items.length > 1) {
    throw new Error('Zap Lead returned an invalid analyses response');
  }
  if (items.length === 0) return null;

  const run = items[0];
  if (
    !isRecord(run) ||
    !isUuid(run.id) ||
    run.status !== 'completed' ||
    (run.completedAt !== null &&
      (typeof run.completedAt !== 'string' ||
        !Number.isFinite(Date.parse(run.completedAt))))
  ) {
    throw new Error('Zap Lead returned an invalid analyses response');
  }
  return { id: run.id, completedAt: run.completedAt };
}

function parseAggregate(
  value: unknown,
  analysisId: string,
  completedAt: string | null
): ZapLeadAnalysisMatrixData {
  if (
    !isRecord(value) ||
    typeof value.apiVersion !== 'string' ||
    !isRecord(value.data)
  ) {
    throw new Error('Zap Lead returned an invalid analysis aggregate');
  }
  const data = value.data;
  if (
    data.analysisId !== analysisId ||
    (data.status !== 'ready' && data.status !== 'pending') ||
    !Number.isInteger(data.totalAnalyzed) ||
    (data.totalAnalyzed as number) < 0 ||
    !Array.isArray(data.matrix) ||
    data.matrix.length > maxMatrixCells
  ) {
    throw new Error('Zap Lead returned an invalid analysis aggregate');
  }

  const matrix = data.matrix.map(
    (cell): ZapLeadAnalysisMatrixData['matrix'][number] => {
      if (
        !isRecord(cell) ||
        !Number.isInteger(cell.leadScore) ||
        (cell.leadScore as number) < 0 ||
        (cell.leadScore as number) > 10 ||
        (cell.serviceScore !== null &&
          (!Number.isInteger(cell.serviceScore) ||
            (cell.serviceScore as number) < 0 ||
            (cell.serviceScore as number) > 10)) ||
        !Number.isInteger(cell.count) ||
        (cell.count as number) < 0 ||
        !Number.isInteger(cell.goodLeadCount) ||
        (cell.goodLeadCount as number) < 0 ||
        (cell.goodLeadCount as number) > (cell.count as number) ||
        typeof cell.percentage !== 'number' ||
        !Number.isFinite(cell.percentage) ||
        cell.percentage < 0 ||
        cell.percentage > 100
      ) {
        throw new Error('Zap Lead returned an invalid analysis aggregate');
      }
      return {
        leadScore: cell.leadScore as number,
        serviceScore: cell.serviceScore as number | null,
        count: cell.count as number,
        goodLeadCount: cell.goodLeadCount as number,
        percentage: cell.percentage,
      };
    }
  );

  return {
    status: data.status,
    completedAt,
    totalAnalyzed: data.totalAnalyzed as number,
    matrix: data.status === 'ready' ? matrix : [],
  };
}

export async function getZapLeadAnalysisMatrixForCurrentAccount(
  days: number,
  now = new Date(),
  filters: ZapLeadDashboardFilters = {}
): Promise<ZapLeadAnalysisMatrixData | null> {
  const range = buildRange(days, now);
  const client = await getZapLeadReadClientForCurrentAccount();
  if (!client) return null;
  const query = new URLSearchParams({
    from: range.from,
    to: range.to,
    status: 'completed',
    limit: '1',
  });
  appendZapLeadDashboardFilters(query, filters);
  const runs = await client.get<unknown>(
    `/api/agency/v1/analyses?${query.toString()}`
  );
  const latest = parseRunList(runs);
  if (!latest) {
    return { status: 'empty', completedAt: null, totalAnalyzed: 0, matrix: [] };
  }
  const aggregate = await client.get<unknown>(
    `/api/agency/v1/analyses/${latest.id}/aggregate`
  );
  return parseAggregate(aggregate, latest.id, latest.completedAt);
}
