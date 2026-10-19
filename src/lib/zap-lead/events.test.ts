import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  zapLeadAdminClient: vi.fn(),
  rpc: vi.fn(),
}));

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
  });

  it('sends only technical receipt fields to the atomic database function', async () => {
    await expect(acceptZapLeadWebhookEvent(receipt)).resolves.toBe('accepted');

    expect(mocks.rpc).toHaveBeenCalledWith('accept_zap_lead_webhook_event', {
      p_account_id: receipt.accountId,
      p_key_id: receipt.keyId,
      p_nonce: receipt.nonce,
      p_event_id: receipt.eventId,
      p_event_type: receipt.eventType,
      p_occurred_at: receipt.occurredAt,
    });
  });

  it('persists only technical SSE receipt fields and its event cursor', async () => {
    const expectedCursor = 'b725b80f-3f64-4bcb-9020-92336bce6ebd';
    await expect(
      recordZapLeadSseEvent(sseReceipt, expectedCursor)
    ).resolves.toBe('accepted');
    expect(mocks.rpc).toHaveBeenCalledWith('record_zap_lead_sse_event', {
      p_account_id: sseReceipt.accountId,
      p_key_id: sseReceipt.keyId,
      p_expected_cursor: expectedCursor,
      p_event_id: sseReceipt.eventId,
      p_event_type: sseReceipt.eventType,
      p_occurred_at: sseReceipt.occurredAt,
    });
  });

  it('returns stale stream cursor results for overlap recovery', async () => {
    mocks.rpc.mockResolvedValueOnce({ data: 'stale', error: null });

    await expect(recordZapLeadSseEvent(sseReceipt, null)).resolves.toBe(
      'stale'
    );
  });

  it('binds heartbeat state changes to the credential generation', async () => {
    const checkedAt = new Date('2026-10-14T09:00:00.000Z');
    mocks.rpc.mockResolvedValue({ data: false, error: null });

    await expect(
      recordZapLeadHealthSuccess('account-a', sseReceipt.keyId, checkedAt)
    ).resolves.toBe(false);
    expect(mocks.rpc).toHaveBeenLastCalledWith(
      'record_zap_lead_health_success',
      {
        p_account_id: 'account-a',
        p_key_id: sseReceipt.keyId,
        p_checked_at: checkedAt.toISOString(),
      }
    );

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
  });

  it('returns duplicate, replay and invalid states without treating them as accepted', async () => {
    for (const state of ['duplicate', 'replay', 'invalid'] as const) {
      mocks.rpc.mockResolvedValueOnce({ data: state, error: null });
      await expect(acceptZapLeadWebhookEvent(receipt)).resolves.toBe(state);
    }
  });

  it('fails closed on database errors or unknown procedure results', async () => {
    mocks.rpc.mockResolvedValueOnce({
      data: null,
      error: { message: 'offline' },
    });
    await expect(acceptZapLeadWebhookEvent(receipt)).rejects.toThrow(
      'Could not persist Zap Lead webhook receipt'
    );

    mocks.rpc.mockResolvedValueOnce({ data: 'unexpected', error: null });
    await expect(acceptZapLeadWebhookEvent(receipt)).rejects.toThrow(
      'Zap Lead webhook receipt returned an invalid status'
    );
  });
});
