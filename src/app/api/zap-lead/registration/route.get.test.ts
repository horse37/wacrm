import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  requireRole: vi.fn(),
  toErrorResponse: vi.fn(() =>
    Response.json({ error: 'Internal server error' }, { status: 500 })
  ),
  createRepository: vi.fn(),
  getIntegration: vi.fn(),
  getHeartbeatState: vi.fn(),
}));

vi.mock('@/lib/auth/account', () => ({
  requireRole: mocks.requireRole,
  toErrorResponse: mocks.toErrorResponse,
}));
vi.mock('@/lib/repositories/zap-lead-registration-read', () => ({
  createPostgresZapLeadRegistrationReadRepository: mocks.createRepository,
}));
vi.mock('@/lib/zap-lead/credentials', () => ({
  removeZapLeadCredentials: vi.fn(),
  saveZapLeadCredentials: vi.fn(),
}));
vi.mock('@/lib/zap-lead/registration', () => ({
  generateZapLeadRegistration: vi.fn(),
}));
vi.mock('@/lib/rate-limit', () => ({
  checkRateLimit: vi.fn(() => ({ success: true })),
  rateLimitResponse: vi.fn(),
  RATE_LIMITS: { adminAction: {} },
}));

import { GET } from './route';

const userId = '00000000-0000-4000-8000-000000000001';
const accountId = '10000000-0000-4000-8000-000000000001';
const keyId = 'ak_000000000000000000000000';

describe('Zap Lead registration GET PostgreSQL reads', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireRole.mockResolvedValue({ userId, accountId });
    mocks.createRepository.mockReturnValue({
      getIntegration: mocks.getIntegration,
      getHeartbeatState: mocks.getHeartbeatState,
    });
    mocks.getIntegration.mockResolvedValue({
      apiBaseUrl: 'https://zap.example.test',
      keyId,
    });
    mocks.getHeartbeatState.mockResolvedValue({
      lastSuccessAt: '2026-10-21T09:00:00.000Z',
      lastFailureAt: null,
      lastErrorCode: null,
      alertSentAt: null,
    });
  });

  it('reads only current-account technical configuration and heartbeat from PostgreSQL', async () => {
    const response = await GET();

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      configured: true,
      apiBaseUrl: 'https://zap.example.test',
      generation: keyId,
      heartbeat: {
        lastSuccessAt: '2026-10-21T09:00:00.000Z',
        lastFailureAt: null,
        lastErrorCode: null,
        alertSentAt: null,
      },
    });
    expect(mocks.requireRole).toHaveBeenCalledWith('admin');
    expect(mocks.createRepository).toHaveBeenCalledWith({ userId, accountId });
    expect(mocks.getIntegration).toHaveBeenCalledOnce();
    expect(mocks.getHeartbeatState).toHaveBeenCalledWith(keyId);
  });

  it('does not read heartbeat when integration is absent', async () => {
    mocks.getIntegration.mockResolvedValue(null);

    const response = await GET();

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      configured: false,
      apiBaseUrl: null,
      generation: null,
    });
    expect(mocks.getHeartbeatState).not.toHaveBeenCalled();
  });

  it('returns empty heartbeat fields when configured integration has no state', async () => {
    mocks.getHeartbeatState.mockResolvedValue(null);

    const response = await GET();

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      configured: true,
      apiBaseUrl: 'https://zap.example.test',
      generation: keyId,
      heartbeat: {
        lastSuccessAt: null,
        lastFailureAt: null,
        lastErrorCode: null,
        alertSentAt: null,
      },
    });
  });

  it('preserves the integration status error response when PostgreSQL read fails', async () => {
    mocks.getIntegration.mockRejectedValue(
      new Error('synthetic database failure')
    );

    const response = await GET();

    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({
      error: 'Could not load Zap Lead integration status',
    });
  });

  it('preserves the heartbeat status error response when PostgreSQL state read fails', async () => {
    mocks.getHeartbeatState.mockRejectedValue(
      new Error('synthetic database failure')
    );

    const response = await GET();

    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({
      error: 'Could not load Zap Lead heartbeat status',
    });
  });
});
