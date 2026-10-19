import { createHash, createHmac } from 'node:crypto';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  getZapLeadWebhookCredential: vi.fn(),
  acceptZapLeadWebhookEvent: vi.fn(),
}));

vi.mock('@/lib/zap-lead/credentials', () => ({
  getZapLeadWebhookCredential: mocks.getZapLeadWebhookCredential,
}));
vi.mock('@/lib/zap-lead/events', () => ({
  acceptZapLeadWebhookEvent: mocks.acceptZapLeadWebhookEvent,
}));

import { POST } from '@/app/api/zap-lead/webhook/route';

const secret = 'test_secret_for_local_fixture_0001';
const keyId = 'ak_000000000000000000000000';
const timestamp = '2026-10-13T12:34:56.000Z';
const nonce = 'nonce-test-00000001';
const event = {
  apiVersion: '1.0.0',
  eventId: '18fae01a-a5b8-4a7e-95af-453810e49dc9',
  eventType: 'lead.created',
  occurredAt: '2026-10-13T12:30:00.000Z',
  summary: 'Novo lead fictício.',
  data: {
    leadId: 'c725b80f-3f64-4bcb-9020-92336bce6ebd',
    campaignId: null,
  },
};

const validEventData = [
  [
    'lead.created',
    { leadId: 'c725b80f-3f64-4bcb-9020-92336bce6ebd', campaignId: null },
  ],
  [
    'lead.stage.changed',
    {
      leadId: 'c725b80f-3f64-4bcb-9020-92336bce6ebd',
      previousStageId: null,
      stageId: 'a725b80f-3f64-4bcb-9020-92336bce6ebd',
    },
  ],
  [
    'lead.stage.pending_confirmation',
    {
      leadId: 'c725b80f-3f64-4bcb-9020-92336bce6ebd',
      stageId: 'a725b80f-3f64-4bcb-9020-92336bce6ebd',
    },
  ],
  [
    'response.deadline.exceeded',
    {
      leadId: 'c725b80f-3f64-4bcb-9020-92336bce6ebd',
      assignmentId: 'b725b80f-3f64-4bcb-9020-92336bce6ebd',
    },
  ],
  [
    'lead.assigned',
    {
      leadId: 'c725b80f-3f64-4bcb-9020-92336bce6ebd',
      sellerId: 'b725b80f-3f64-4bcb-9020-92336bce6ebd',
      departmentId: null,
    },
  ],
  [
    'seller.channel.disconnected',
    {
      sellerId: 'b725b80f-3f64-4bcb-9020-92336bce6ebd',
      numberId: 'c725b80f-3f64-4bcb-9020-92336bce6ebd',
    },
  ],
  [
    'analysis.completed',
    { analysisId: 'd725b80f-3f64-4bcb-9020-92336bce6ebd', status: 'completed' },
  ],
] as const;

function createRequest(
  bodyValue: unknown = event,
  overrides: Partial<Record<string, string>> = {}
): Request {
  const body = JSON.stringify(bodyValue);
  const bodyHash = createHash('sha256').update(body).digest('hex');
  const signature = createHmac('sha256', secret)
    .update(
      ['POST', '/api/zap-lead/webhook', timestamp, nonce, bodyHash].join('\n')
    )
    .digest('hex');

  return new Request('https://agency.example.test/api/zap-lead/webhook', {
    method: 'POST',
    headers: {
      'X-Zap-Key': keyId,
      'X-Zap-Timestamp': timestamp,
      'X-Zap-Nonce': nonce,
      'X-Zap-Signature': signature,
      ...overrides,
    },
    body,
  });
}

describe('Zap Lead webhook route', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    vi.setSystemTime(new Date(timestamp));
    mocks.getZapLeadWebhookCredential.mockResolvedValue({
      accountId: 'account-a',
      registration: {
        version: 1,
        keyId,
        secret,
        webhookUrl: 'https://agency.example.test/api/zap-lead/webhook',
        events: ['lead.created'],
      },
    });
    mocks.acceptZapLeadWebhookEvent.mockResolvedValue('accepted');
  });

  it('accepts a signed event and persists only its technical receipt', async () => {
    const response = await POST(createRequest());

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ accepted: true, duplicate: false });
    expect(mocks.acceptZapLeadWebhookEvent).toHaveBeenCalledWith({
      accountId: 'account-a',
      keyId,
      nonce,
      eventId: event.eventId,
      eventType: event.eventType,
      occurredAt: event.occurredAt,
    });
    expect(
      JSON.stringify(mocks.acceptZapLeadWebhookEvent.mock.calls)
    ).not.toContain(JSON.stringify(event.data));
  });

  it('acknowledges an already received event without duplicating its receipt', async () => {
    mocks.acceptZapLeadWebhookEvent.mockResolvedValue('duplicate');

    const response = await POST(createRequest());

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ accepted: true, duplicate: true });
  });

  it('rejects reuse of the signing nonce', async () => {
    mocks.acceptZapLeadWebhookEvent.mockResolvedValue('replay');

    const response = await POST(createRequest());

    expect(response.status).toBe(409);
    expect(mocks.acceptZapLeadWebhookEvent).toHaveBeenCalledOnce();
  });

  it('rejects stale signatures before looking up or persisting an event', async () => {
    vi.setSystemTime(new Date(Date.parse(timestamp) + 5 * 60_000 + 1));

    const response = await POST(createRequest());

    expect(response.status).toBe(401);
    expect(mocks.getZapLeadWebhookCredential).not.toHaveBeenCalled();
    expect(mocks.acceptZapLeadWebhookEvent).not.toHaveBeenCalled();
  });

  it('rejects a validly signed event outside the registration event scope', async () => {
    const response = await POST(
      createRequest({
        ...event,
        eventType: 'analysis.completed',
        data: {
          analysisId: 'd725b80f-3f64-4bcb-9020-92336bce6ebd',
          status: 'completed',
        },
      })
    );

    expect(response.status).toBe(403);
    expect(mocks.acceptZapLeadWebhookEvent).not.toHaveBeenCalled();
  });

  it('rejects an invalid signature without recording a receipt', async () => {
    const response = await POST(
      createRequest(event, { 'X-Zap-Signature': '0'.repeat(64) })
    );

    expect(response.status).toBe(401);
    expect(mocks.acceptZapLeadWebhookEvent).not.toHaveBeenCalled();
  });

  it('rejects malformed event metadata before persistence', async () => {
    const response = await POST(createRequest({ ...event, eventId: 'bad-id' }));

    expect(response.status).toBe(400);
    expect(mocks.acceptZapLeadWebhookEvent).not.toHaveBeenCalled();
  });

  it.each(validEventData)(
    'accepts contract-shaped %s data',
    async (eventType, data) => {
      mocks.getZapLeadWebhookCredential.mockResolvedValue({
        accountId: 'account-a',
        registration: {
          version: 1,
          keyId,
          secret,
          webhookUrl: 'https://agency.example.test/api/zap-lead/webhook',
          events: [eventType],
        },
      });

      const response = await POST(createRequest({ ...event, eventType, data }));

      expect(response.status).toBe(200);
    }
  );

  it.each([
    { leadId: 'c725b80f-3f64-4bcb-9020-92336bce6ebd' },
    {
      leadId: 'c725b80f-3f64-4bcb-9020-92336bce6ebd',
      campaignId: null,
      leakedPayload: 'must not be accepted',
    },
    {
      leadId: 'c725b80f-3f64-4bcb-9020-92336bce6ebd',
      campaignId: 'not-a-uuid',
    },
  ])('rejects lead.created data outside its strict contract', async (data) => {
    const response = await POST(createRequest({ ...event, data }));

    expect(response.status).toBe(400);
    expect(mocks.acceptZapLeadWebhookEvent).not.toHaveBeenCalled();
  });
});
