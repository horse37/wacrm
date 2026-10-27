import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  acceptZapLeadWebhookReceipt: vi.fn(),
  recordZapLeadHealthSuccess: vi.fn(),
  recordZapLeadHealthFailure: vi.fn(),
  claimZapLeadHeartbeatAlert: vi.fn(),
  zapLeadAdminClient: vi.fn(),
  rpc: vi.fn(),
  query: vi.fn(),
  withTransaction: vi.fn(),
}));

vi.mock('../repositories/zap-lead-webhook-receipt', () => ({
  acceptZapLeadWebhookReceipt: mocks.acceptZapLeadWebhookReceipt,
}));
vi.mock('../repositories/zap-lead-heartbeat', () => ({
  recordZapLeadHealthSuccess: mocks.recordZapLeadHealthSuccess,
  recordZapLeadHealthFailure: mocks.recordZapLeadHealthFailure,
  claimZapLeadHeartbeatAlert: mocks.claimZapLeadHeartbeatAlert,
}));

vi.mock('../db/postgres-client', () => ({
  withTransaction: mocks.withTransaction,
}));

vi.mock('server-only', () => ({}));

vi.mock('./admin-client', () => ({
  zapLeadAdminClient: mocks.zapLeadAdminClient,
}));

import {
  acceptZapLeadWebhookEvent,
  claimZapLeadHeartbeatAlert,
  recordZapLeadHealthFailure,
  recordZapLeadHealthSuccess,
  recordZapLeadSseEvent,
} from './events';

const receipt = {
  accountId: 'account-a',
  keyId: 'ak_000000000000000000000000',
  nonce: 'nonce-test-00000001',
  eventId: '18fae01a-a5b8-4a7e-95af-453810e49dc9',
  eventType: 'lead.created',
  occurredAt: '2026-10-13T12:30:00.000Z',
};
const sseReceipt = {
  accountId: 'account-a',
  keyId: 'ak_000000000000000000000000',
  eventId: '18fae01a-a5b8-4a7e-95af-453810e49dc9',
  eventType: 'conversation.message.created' as const,
  occurredAt: '2026-10-13T12:30:00.000Z',
};

describe('Zap Lead event receipt persistence', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.zapLeadAdminClient.mockReturnValue({ rpc: mocks.rpc });
    mocks.rpc.mockResolvedValue({ data: 'accepted', error: null });
    mocks.acceptZapLeadWebhookReceipt.mockResolvedValue('accepted');
    mocks.recordZapLeadHealthSuccess.mockResolvedValue(false);
    mocks.recordZapLeadHealthFailure.mockResolvedValue(false);
    mocks.claimZapLeadHeartbeatAlert.mockResolvedValue(false);
    mocks.query.mockResolvedValue({
      rows: [{ status: 'accepted' }],
      rowCount: 1,
    });
    mocks.withTransaction.mockImplementation(async (operation) => ({
      ok: true,
      data: await operation({ query: mocks.query }),
    }));
  });

  it('sends only technical receipt fields to the atomic database function', async () => {
    await expect(acceptZapLeadWebhookEvent(receipt)).resolves.toBe('accepted');

    expect(mocks.acceptZapLeadWebhookReceipt).toHaveBeenCalledWith(receipt);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it('persists only technical SSE receipt fields and its event cursor', async () => {
    const expectedCursor = 'b725b80f-3f64-4bcb-9020-92336bce6ebd';
    await expect(
      recordZapLeadSseEvent(sseReceipt, expectedCursor)
    ).resolves.toBe('accepted');
    expect(mocks.rpc).not.toHaveBeenCalled();
    expect(mocks.withTransaction).toHaveBeenCalledOnce();
    expect(mocks.query).toHaveBeenCalledWith(
      expect.stringMatching(
        /SELECT public\.record_zap_lead_sse_event\(\$1::uuid, \$2::text, \$3::uuid, \$4::uuid, \$5::text, \$6::timestamptz\) AS status/
      ),
      [
        sseReceipt.accountId,
        sseReceipt.keyId,
        expectedCursor,
        sseReceipt.eventId,
        sseReceipt.eventType,
        sseReceipt.occurredAt,
      ]
    );
  });

  it('returns stale stream cursor results for overlap recovery', async () => {
    mocks.query.mockResolvedValueOnce({
      rows: [{ status: 'stale' }],
      rowCount: 1,
    });

    await expect(recordZapLeadSseEvent(sseReceipt, null)).resolves.toBe(
      'stale'
    );
  });

  it.each(['duplicate', 'invalid'] as const)(
    'preserves %s SSE function results',
    async (status) => {
      mocks.query.mockResolvedValueOnce({ rows: [{ status }], rowCount: 1 });
      await expect(recordZapLeadSseEvent(sseReceipt, null)).resolves.toBe(
        status
      );
    }
  );

  it('rejects unknown function status and generic transaction failure', async () => {
    mocks.query.mockResolvedValueOnce({
      rows: [{ status: 'unexpected' }],
      rowCount: 1,
    });
    await expect(recordZapLeadSseEvent(sseReceipt, null)).rejects.toThrow(
      'Zap Lead SSE receipt returned an invalid status'
    );

    mocks.withTransaction.mockResolvedValueOnce({
      ok: false,
      error: new Error('database detail must not escape'),
    });
    await expect(recordZapLeadSseEvent(sseReceipt, null)).rejects.toThrow(
      'Could not persist Zap Lead SSE receipt'
    );
  });

  it('delegates all heartbeat writes without using Supabase RPC', async () => {
    const checkedAt = new Date('2026-10-14T09:00:00.000Z');

    await expect(
      recordZapLeadHealthSuccess('account-a', sseReceipt.keyId, checkedAt)
    ).resolves.toBe(false);
    await expect(
      recordZapLeadHealthFailure(
        'account-a',
        sseReceipt.keyId,
        'health_request_failed',
        checkedAt
      )
    ).resolves.toBe(false);
    await expect(
      claimZapLeadHeartbeatAlert('account-a', sseReceipt.keyId, checkedAt)
    ).resolves.toBe(false);

    expect(mocks.recordZapLeadHealthSuccess).toHaveBeenCalledWith(
      'account-a',
      sseReceipt.keyId,
      checkedAt
    );
    expect(mocks.recordZapLeadHealthFailure).toHaveBeenCalledWith(
      'account-a',
      sseReceipt.keyId,
      'health_request_failed',
      checkedAt
    );
    expect(mocks.claimZapLeadHeartbeatAlert).toHaveBeenCalledWith(
      'account-a',
      sseReceipt.keyId,
      checkedAt
    );
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it('returns duplicate, replay and invalid states without treating them as accepted', async () => {
    for (const state of ['duplicate', 'replay', 'invalid'] as const) {
      mocks.acceptZapLeadWebhookReceipt.mockResolvedValueOnce(state);
      await expect(acceptZapLeadWebhookEvent(receipt)).resolves.toBe(state);
    }
  });

  it('fails closed on database errors or unknown procedure results', async () => {
    mocks.acceptZapLeadWebhookReceipt.mockRejectedValueOnce(
      new Error('Could not persist Zap Lead webhook receipt')
    );
    await expect(acceptZapLeadWebhookEvent(receipt)).rejects.toThrow(
      'Could not persist Zap Lead webhook receipt'
    );

    mocks.acceptZapLeadWebhookReceipt.mockRejectedValueOnce(
      new Error('Zap Lead webhook receipt returned an invalid status')
    );
    await expect(acceptZapLeadWebhookEvent(receipt)).rejects.toThrow(
      'Zap Lead webhook receipt returned an invalid status'
    );
  });
});
