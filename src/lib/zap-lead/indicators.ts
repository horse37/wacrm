import { getZapLeadReadClientForCurrentAccount } from './credentials';
import {
  appendZapLeadDashboardFilters,
  type ZapLeadDashboardFilters,
} from './dashboard-filters';

const periods = [7, 30, 90] as const;
const units = {
  leads_created: 'count',
  first_response_seconds_avg: 'seconds',
  responded_within_5m: 'percent',
  responded_within_15m: 'percent',
  responded_within_60m: 'percent',
  leads_without_response: 'count',
  follow_ups: 'count',
  deadline_expired: 'count',
  abandoned_conversations: 'count',
} as const;

export type ZapLeadIndicatorKey = keyof typeof units;
export type ZapLeadIndicatorUnit = (typeof units)[ZapLeadIndicatorKey];
export interface ZapLeadIndicatorsData {
  period: { from: string; to: string };
  items: Array<{
    key: ZapLeadIndicatorKey;
    value: number;
    unit: ZapLeadIndicatorUnit;
  }>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function parseIndicators(value: unknown): ZapLeadIndicatorsData {
  if (
    !isRecord(value) ||
    typeof value.apiVersion !== 'string' ||
    !isRecord(value.data)
  ) {
    throw new Error('Zap Lead returned an invalid indicators response');
  }
  const data = value.data;
  const period = data.period;
  if (
    !isRecord(period) ||
    typeof period.from !== 'string' ||
    typeof period.to !== 'string' ||
    !Number.isFinite(Date.parse(period.from)) ||
    !Number.isFinite(Date.parse(period.to)) ||
    !Array.isArray(data.items)
  ) {
    throw new Error('Zap Lead returned an invalid indicators response');
  }

  const items = data.items.map(
    (item): ZapLeadIndicatorsData['items'][number] => {
      if (
        !isRecord(item) ||
        typeof item.key !== 'string' ||
        !(item.key in units) ||
        typeof item.value !== 'number' ||
        !Number.isFinite(item.value) ||
        item.unit !== units[item.key as ZapLeadIndicatorKey]
      ) {
        throw new Error('Zap Lead returned an invalid indicators response');
      }
      return {
        key: item.key as ZapLeadIndicatorKey,
        value: item.value,
        unit: item.unit as ZapLeadIndicatorUnit,
      };
    }
  );

  return {
    period: { from: period.from, to: period.to },
    items,
  };
}

function buildRange(days: number, now: Date): { from: string; to: string } {
  if (!periods.includes(days as (typeof periods)[number])) {
    throw new Error('Unsupported Zap Lead indicator period');
  }
  if (!Number.isFinite(now.getTime())) {
    throw new Error('Invalid Zap Lead indicator date');
  }
  const midnight = Date.UTC(
    now.getUTCFullYear(),
    now.getUTCMonth(),
    now.getUTCDate()
  );
  return {
    from: new Date(midnight - (days - 1) * 24 * 60 * 60 * 1000).toISOString(),
    to: new Date(midnight + 24 * 60 * 60 * 1000 - 1).toISOString(),
  };
}

export async function getZapLeadIndicatorsForCurrentAccount(
  days: number,
  now = new Date(),
  filters: ZapLeadDashboardFilters = {}
): Promise<ZapLeadIndicatorsData | null> {
  const range = buildRange(days, now);
  const client = await getZapLeadReadClientForCurrentAccount();
  if (!client) return null;
  const query = new URLSearchParams(range);
  appendZapLeadDashboardFilters(query, filters);
  const response = await client.get<unknown>(
    `/api/agency/v1/indicators?${query.toString()}`
  );
  return parseIndicators(response);
}
