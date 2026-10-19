import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getZapLeadIndicatorsForCurrentAccount } from './indicators';

const mocks = vi.hoisted(() => ({
  getReadClient: vi.fn(),
  get: vi.fn(),
}));

vi.mock('./credentials', () => ({
  getZapLeadReadClientForCurrentAccount: mocks.getReadClient,
}));

const response = {
  apiVersion: '1',
  data: {
    period: {
      from: '2026-10-08T00:00:00.000Z',
      to: '2026-10-14T23:59:59.999Z',
    },
    items: [
      {
        key: 'leads_created',
        label: 'Leads recebidos',
        value: 12,
        unit: 'count',
      },
      {
        key: 'first_response_seconds_avg',
        label: 'Tempo médio da primeira resposta',
        value: 84,
        unit: 'seconds',
      },
    ],
  },
};
const expected = {
  period: response.data.period,
  items: response.data.items.map(({ key, value, unit }) => ({
    key,
    value,
    unit,
  })),
};

describe('Zap Lead indicator reads', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getReadClient.mockResolvedValue({ get: mocks.get });
    mocks.get.mockResolvedValue(response);
  });

  it('queries the current account installation for an inclusive UTC date range', async () => {
    await expect(
      getZapLeadIndicatorsForCurrentAccount(
        7,
        new Date('2026-10-14T12:34:56.789Z')
      )
    ).resolves.toEqual(expected);

    expect(mocks.get).toHaveBeenCalledWith(
      '/api/agency/v1/indicators?from=2026-10-08T00%3A00%3A00.000Z&to=2026-10-14T23%3A59%3A59.999Z'
    );
  });
  it('forwards seller and campaign filters to the current account installation', async () => {
    await expect(
      getZapLeadIndicatorsForCurrentAccount(
        30,
        new Date('2026-10-14T12:34:56.789Z'),
        {
          sellerId: 'A1111111-1111-4111-8111-111111111111',
          campaignCode: 'LANCTO-TESTE',
        }
      )
    ).resolves.toEqual(expected);
    expect(mocks.get).toHaveBeenCalledWith(
      '/api/agency/v1/indicators?from=2026-09-15T00%3A00%3A00.000Z&to=2026-10-14T23%3A59%3A59.999Z&sellerId=a1111111-1111-4111-8111-111111111111&campaignCode=LANCTO-TESTE'
    );
  });

  it('rejects unsupported periods before loading credentials', async () => {
    await expect(getZapLeadIndicatorsForCurrentAccount(14)).rejects.toThrow();
    expect(mocks.getReadClient).not.toHaveBeenCalled();
  });

  it('returns null when the account has no Zap Lead installation', async () => {
    mocks.getReadClient.mockResolvedValue(null);

    await expect(
      getZapLeadIndicatorsForCurrentAccount(
        30,
        new Date('2026-10-14T12:00:00.000Z')
      )
    ).resolves.toBeNull();
  });

  it('rejects malformed upstream indicator data', async () => {
    mocks.get.mockResolvedValue({
      apiVersion: '1',
      data: { items: 'invalid' },
    });

    await expect(
      getZapLeadIndicatorsForCurrentAccount(
        7,
        new Date('2026-10-14T12:00:00.000Z')
      )
    ).rejects.toThrow();
  });
});
