import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getZapLeadAnalysisMatrixForCurrentAccount } from './analysis-matrix';

const mocks = vi.hoisted(() => ({
  getReadClient: vi.fn(),
  get: vi.fn(),
}));

vi.mock('./credentials', () => ({
  getZapLeadReadClientForCurrentAccount: mocks.getReadClient,
}));

const runsResponse = {
  apiVersion: '1',
  data: {
    items: [
      {
        id: '11111111-1111-4111-8111-111111111111',
        status: 'completed',
        completedAt: '2026-10-14T12:00:00.000Z',
      },
    ],
  },
};

const aggregateResponse = {
  apiVersion: '1',
  data: {
    analysisId: '11111111-1111-4111-8111-111111111111',
    status: 'ready',
    totalAnalyzed: 2,
    averageLeadScore: 8,
    averageServiceScore: 7,
    goodLeadCount: 1,
    temperatures: { cold: 0, warm: 1, hot: 1, unknown: 0 },
    criteriaAverages: {},
    matrix: [
      {
        leadScore: 8,
        serviceScore: 7,
        count: 2,
        goodLeadCount: 1,
        percentage: 100,
      },
    ],
    executiveSummary: {
      summary: 'do not expose',
      strengths: [],
      risks: [],
      recommendations: [],
    },
    summaryStatus: 'completed',
  },
};

describe('Zap Lead analysis matrix reads', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getReadClient.mockResolvedValue({ get: mocks.get });
    mocks.get.mockImplementation((path: string) =>
      Promise.resolve(
        path.includes('/analyses?') ? runsResponse : aggregateResponse
      )
    );
  });

  it('loads only the latest completed run in the inclusive UTC period and returns the matrix only', async () => {
    await expect(
      getZapLeadAnalysisMatrixForCurrentAccount(
        7,
        new Date('2026-10-14T12:00:00.000Z')
      )
    ).resolves.toEqual({
      status: 'ready',
      completedAt: '2026-10-14T12:00:00.000Z',
      totalAnalyzed: 2,
      matrix: [
        {
          leadScore: 8,
          serviceScore: 7,
          count: 2,
          goodLeadCount: 1,
          percentage: 100,
        },
      ],
    });

    expect(mocks.get).toHaveBeenNthCalledWith(
      1,
      '/api/agency/v1/analyses?from=2026-10-08T00%3A00%3A00.000Z&to=2026-10-14T23%3A59%3A59.999Z&status=completed&limit=1'
    );
    expect(mocks.get).toHaveBeenNthCalledWith(
      2,
      '/api/agency/v1/analyses/11111111-1111-4111-8111-111111111111/aggregate'
    );
  });
  it('applies seller and campaign filters to the completed-analysis lookup', async () => {
    await expect(
      getZapLeadAnalysisMatrixForCurrentAccount(
        30,
        new Date('2026-10-14T12:00:00.000Z'),
        {
          sellerId: 'A1111111-1111-4111-8111-111111111111',
          campaignCode: 'LANCTO-TESTE',
        }
      )
    ).resolves.toMatchObject({ status: 'ready' });
    expect(mocks.get).toHaveBeenNthCalledWith(
      1,
      '/api/agency/v1/analyses?from=2026-09-15T00%3A00%3A00.000Z&to=2026-10-14T23%3A59%3A59.999Z&status=completed&limit=1&sellerId=a1111111-1111-4111-8111-111111111111&campaignCode=LANCTO-TESTE'
    );
  });

  it('rejects unsupported periods before loading credentials', async () => {
    await expect(
      getZapLeadAnalysisMatrixForCurrentAccount(14)
    ).rejects.toThrow();
    expect(mocks.getReadClient).not.toHaveBeenCalled();
  });

  it('returns null when the account has no linked installation', async () => {
    mocks.getReadClient.mockResolvedValue(null);
    await expect(
      getZapLeadAnalysisMatrixForCurrentAccount(30)
    ).resolves.toBeNull();
    expect(mocks.get).not.toHaveBeenCalled();
  });

  it('returns an empty matrix when no completed run exists in the period', async () => {
    mocks.get.mockResolvedValueOnce({ apiVersion: '1', data: { items: [] } });
    await expect(
      getZapLeadAnalysisMatrixForCurrentAccount(
        30,
        new Date('2026-10-14T12:00:00.000Z')
      )
    ).resolves.toEqual({
      status: 'empty',
      completedAt: null,
      totalAnalyzed: 0,
      matrix: [],
    });
    expect(mocks.get).toHaveBeenCalledTimes(1);
  });

  it('rejects malformed matrix cells and oversized matrices', async () => {
    mocks.get.mockResolvedValueOnce(runsResponse).mockResolvedValueOnce({
      ...aggregateResponse,
      data: {
        ...aggregateResponse.data,
        matrix: [{ ...aggregateResponse.data.matrix[0], count: -1 }],
      },
    });
    await expect(
      getZapLeadAnalysisMatrixForCurrentAccount(7)
    ).rejects.toThrow();

    mocks.get.mockResolvedValueOnce(runsResponse).mockResolvedValueOnce({
      ...aggregateResponse,
      data: {
        ...aggregateResponse.data,
        matrix: Array(133).fill(aggregateResponse.data.matrix[0]),
      },
    });
    await expect(
      getZapLeadAnalysisMatrixForCurrentAccount(7)
    ).rejects.toThrow();
  });
});
