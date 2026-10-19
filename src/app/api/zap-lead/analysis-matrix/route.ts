import { ForbiddenError, UnauthorizedError } from '@/lib/auth/account';
import { getZapLeadAnalysisMatrixForCurrentAccount } from '@/lib/zap-lead/analysis-matrix';
import { parseZapLeadDashboardQuery } from '@/lib/zap-lead/dashboard-filters';

export const dynamic = 'force-dynamic';

export async function GET(request: Request): Promise<Response> {
  const query = parseZapLeadDashboardQuery(new URL(request.url).searchParams);
  if (!query) {
    return Response.json({ error: 'invalid_query' }, { status: 400 });
  }

  try {
    const data = await getZapLeadAnalysisMatrixForCurrentAccount(
      query.days,
      new Date(),
      query.filters
    );
    if (!data) {
      return Response.json(
        { error: 'zap_lead_not_configured' },
        { status: 404, headers: { 'Cache-Control': 'no-store' } }
      );
    }
    return Response.json(data, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    if (error instanceof UnauthorizedError || error instanceof ForbiddenError) {
      return Response.json({ error: error.message }, { status: error.status });
    }
    return Response.json(
      { error: 'zap_lead_unavailable' },
      { status: 502, headers: { 'Cache-Control': 'no-store' } }
    );
  }
}
