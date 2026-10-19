export interface ZapLeadDashboardFilters {
  sellerId?: string;
  campaignCode?: string;
}

const sellerIdPattern =
  /^[\da-f]{8}-[\da-f]{4}-[1-8][\da-f]{3}-[89ab][\da-f]{3}-[\da-f]{12}$/i;

export function parseZapLeadDashboardQuery(
  params: URLSearchParams
): { days: 7 | 30 | 90; filters: ZapLeadDashboardFilters } | null {
  const allowedKeys = new Set(['days', 'sellerId', 'campaignCode']);
  const dayValues = params.getAll('days');
  const days = dayValues[0] ?? '30';
  const sellerValues = params.getAll('sellerId');
  const campaignValues = params.getAll('campaignCode');
  const sellerId = sellerValues[0]?.toLowerCase();
  const campaignCode = campaignValues[0];

  if (
    [...params.keys()].some((key) => !allowedKeys.has(key)) ||
    dayValues.length > 1 ||
    sellerValues.length > 1 ||
    campaignValues.length > 1 ||
    !['7', '30', '90'].includes(days) ||
    (sellerId !== undefined && !sellerIdPattern.test(sellerId)) ||
    (campaignCode !== undefined &&
      (campaignCode.length === 0 || campaignCode.length > 80))
  ) {
    return null;
  }

  return {
    days: Number(days) as 7 | 30 | 90,
    filters: {
      ...(sellerId ? { sellerId } : {}),
      ...(campaignCode ? { campaignCode } : {}),
    },
  };
}

export function appendZapLeadDashboardFilters(
  params: URLSearchParams,
  filters: ZapLeadDashboardFilters
): void {
  if (filters.sellerId) params.set('sellerId', filters.sellerId.toLowerCase());
  if (filters.campaignCode) params.set('campaignCode', filters.campaignCode);
}
