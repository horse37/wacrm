import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  getZapLeadEventStreamTargetForCurrentAccount: vi.fn(),
  recordZapLeadSseEvent: vi.fn(),
  toErrorResponse: vi.fn(() =>
    Response.json({ error: 'unauthorized' }, { status: 401 })
  ),
}));

vi.mock('@/lib/zap-lead/credentials', () => ({
  getZapLeadEventStreamTargetForCurrentAccount:
    mocks.getZapLeadEventStreamTargetForCurrentAccount,
}));
vi.mock('@/lib/zap-lead/events', () => ({
  recordZapLeadSseEvent: mocks.recordZapLeadSseEvent,
}));
vi.mock('@/lib/auth/account', () => ({
  toErrorResponse: mocks.toErrorResponse,
}));

import { GET } from './route';

const event = {
  apiVersion: '1.0.0',
  eventId: '18fae01a-a5b8-4a7e-95af-453810e49dc9',
  eventType: 'conversation.message.created',
  occurredAt: '2026-10-13T12:30:00.000Z',
  conversationId: 'c725b80f-3f64-4bcb-9020-92336bce6ebd',
  messageId: 'a725b80f-3f64-4bcb-9020-92336bce6ebd',
};
const cursor = 'b725b80f-3f64-4bcb-9020-92336bce6ebd';

function upstreamResponse(value = event) {
  const text = `event: ready\ndata: {}\n\nid: ${value.eventId}\nevent: ${value.eventType}\ndata: ${JSON.stringify(value)}\n\n`;
  return new Response(text, {
    headers: { 'content-type': 'text/event-stream; charset=utf-8' },
  });
}

describe('Zap Lead live event stream route', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getZapLeadEventStreamTargetForCurrentAccount.mockResolvedValue({
      accountId: 'account-a',
      keyId: 'ak_000000000000000000000000',
      cursor,
      client: { openEvents: vi.fn().mockResolvedValue(upstreamResponse()) },
    });
    mocks.recordZapLeadSseEvent.mockResolvedValue('accepted');
  });

  it('resumes from the account cursor and exposes only the technical receipt', async () => {
    const response = await GET(
      new Request('https://crm.example.test/api/zap-lead/events/stream')
    );
    const text = await response.text();
    const target =
      await mocks.getZapLeadEventStreamTargetForCurrentAccount.mock.results[0]
        .value;
    const registeredClient = await target;

    expect(response.headers.get('content-type')).toContain('text/event-stream');
    expect(registeredClient.client.openEvents).toHaveBeenCalledWith(
      cursor,
      expect.any(AbortSignal)
    );
    expect(mocks.recordZapLeadSseEvent).toHaveBeenCalledWith(
      {
        accountId: 'account-a',
        keyId: 'ak_000000000000000000000000',
        eventId: event.eventId,
        eventType: event.eventType,
        occurredAt: event.occurredAt,
      },
      cursor
    );
    expect(text).toContain(`id: ak_000000000000000000000000:${event.eventId}`);
    expect(text).not.toContain(event.conversationId);
    expect(text).not.toContain(event.messageId);
  });

  it('relays a duplicate SSE receipt when this stream advances the cursor', async () => {
    mocks.recordZapLeadSseEvent.mockResolvedValue('duplicate');

    const response = await GET(
      new Request('https://crm.example.test/api/zap-lead/events/stream')
    );
    const text = await response.text();

    expect(text).toContain(`id: ak_000000000000000000000000:${event.eventId}`);
  });

  it('delivers an event when another browser advanced the shared cursor first', async () => {
    mocks.recordZapLeadSseEvent.mockResolvedValue('stale');

    const response = await GET(
      new Request('https://crm.example.test/api/zap-lead/events/stream')
    );
    const text = await response.text();

    expect(text).toContain(`id: ak_000000000000000000000000:${event.eventId}`);
    expect(text).toContain('event: conversation.message.created');
  });

  it('resumes from the browser last-event-id instead of the shared account cursor', async () => {
    await GET(
      new Request('https://crm.example.test/api/zap-lead/events/stream', {
        headers: {
          'Last-Event-ID': `ak_000000000000000000000000:${cursor}`,
        },
      })
    );

    const registeredClient =
      await mocks.getZapLeadEventStreamTargetForCurrentAccount.mock.results[0]
        .value;
    expect(registeredClient.client.openEvents).toHaveBeenCalledWith(
      cursor,
      expect.any(AbortSignal)
    );
  });

  it('ignores a cursor from the previous credential generation', async () => {
    const oldCursor = 'ak_000000000000000000000009:18fae01a-a5b8-4a7e-95af-453810e49dca';

    await GET(
      new Request('https://crm.example.test/api/zap-lead/events/stream', {
        headers: { 'Last-Event-ID': oldCursor },
      })
    );

    const target = await mocks.getZapLeadEventStreamTargetForCurrentAccount.mock.results[0].value;
    expect(target.client.openEvents).toHaveBeenCalledWith(
      cursor,
      expect.any(AbortSignal)
    );
  });

  it('rejects an invalid browser last-event-id before opening upstream', async () => {
    const response = await GET(
      new Request('https://crm.example.test/api/zap-lead/events/stream', {
        headers: { 'Last-Event-ID': 'invalid-cursor' },
      })
    );

    expect(response.status).toBe(400);
    const registeredClient =
      await mocks.getZapLeadEventStreamTargetForCurrentAccount.mock.results[0]
        .value;
    expect(registeredClient.client.openEvents).not.toHaveBeenCalled();
  });

  it('requires a configured installation before opening the upstream stream', async () => {
    mocks.getZapLeadEventStreamTargetForCurrentAccount.mockResolvedValue(null);

    const response = await GET(
      new Request('https://crm.example.test/api/zap-lead/events/stream')
    );

    expect(response.status).toBe(409);
    expect(mocks.recordZapLeadSseEvent).not.toHaveBeenCalled();
  });

  it('fails closed on authorization errors', async () => {
    const authorizationError = new Error('not signed in');
    mocks.getZapLeadEventStreamTargetForCurrentAccount.mockRejectedValue(
      authorizationError
    );

    const response = await GET(
      new Request('https://crm.example.test/api/zap-lead/events/stream')
    );

    expect(response.status).toBe(401);
    expect(mocks.toErrorResponse).toHaveBeenCalledWith(authorizationError);
  });
});
