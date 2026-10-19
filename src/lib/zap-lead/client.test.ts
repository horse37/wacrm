import { createHash, createHmac } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import { createZapLeadClient } from './client';

describe('Zap Lead HMAC client', () => {
  it('signs and sends the exact serialized body and request target', async () => {
    let sentUrl: URL | undefined;
    let sentInit: RequestInit | undefined;
    const fetcher = vi.fn(async (url: URL, init: RequestInit) => {
      sentUrl = url;
      sentInit = init;
      return new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    });
    const client = createZapLeadClient({
      baseUrl: 'https://zap.example.test',
      keyId: 'ak_000000000000000000000000',
      secret: 'test_secret_for_local_fixture_0001',
      fetcher,
      nonce: () => 'nonce-test-001',
      now: () => new Date('2026-10-13T12:34:56.000Z'),
    });
    const body = { b: 2, a: 'ação' };

    await expect(
      client.request(
        'POST',
        '/api/agency/v1/indicators?from=2026-10-01',
        body,
        {
          idempotencyKey: 'req-20261013-command-0001',
        }
      )
    ).resolves.toEqual({ ok: true });

    const url = sentUrl as URL;
    const init = sentInit as RequestInit;
    const headers = new Headers(init.headers);
    const bodyText = JSON.stringify(body);
    const timestamp = '2026-10-13T12:34:56.000Z';
    const bodyHash = createHash('sha256')
      .update(bodyText, 'utf8')
      .digest('hex');
    const canonical = [
      'POST',
      '/api/agency/v1/indicators?from=2026-10-01',
      timestamp,
      'nonce-test-001',
      bodyHash,
    ].join('\n');
    const expectedSignature = createHmac(
      'sha256',
      'test_secret_for_local_fixture_0001'
    )
      .update(canonical, 'utf8')
      .digest('hex');

    expect(url.toString()).toBe(
      'https://zap.example.test/api/agency/v1/indicators?from=2026-10-01'
    );
    expect(init.body).toBe(bodyText);
    expect(headers.get('X-Agency-Key')).toBe('ak_000000000000000000000000');
    expect(headers.get('Idempotency-Key')).toBe('req-20261013-command-0001');
    expect(headers.get('X-Agency-Timestamp')).toBe(timestamp);
    expect(headers.get('X-Agency-Nonce')).toBe('nonce-test-001');
    expect(headers.get('X-Agency-Signature')).toBe(expectedSignature);
    expect(init.cache).toBe('no-store');
    expect(init.redirect).toBe('error');
  });

  it('requires the exact HTTP 200 health status when requested', async () => {
    const fetcher = vi.fn(async () => new Response(null, { status: 204 }));
    const client = createZapLeadClient({
      baseUrl: 'https://zap.example.test',
      keyId: 'ak_000000000000000000000000',
      secret: 'test_secret_for_local_fixture_0001',
      fetcher,
    });

    await expect(
      client.request('GET', '/api/agency/v1/health', undefined, {
        expectedStatus: 200,
      })
    ).rejects.toThrow('Zap Lead API request failed (204)');
  });

  it('rejects non-HTTPS API URLs and paths outside the agency API', async () => {
    expect(() =>
      createZapLeadClient({
        baseUrl: 'http://zap.example.test',
        keyId: 'ak_000000000000000000000000',
        secret: 'test_secret_for_local_fixture_0001',
      })
    ).toThrow('Zap Lead API URL must use HTTPS');

    const client = createZapLeadClient({
      baseUrl: 'https://zap.example.test',
      keyId: 'ak_000000000000000000000000',
      secret: 'test_secret_for_local_fixture_0001',
    });
    await expect(
      client.request('GET', '//evil.example.test/path')
    ).rejects.toThrow('Invalid Zap Lead API path');
  });

  it('requires an idempotency key for write requests', async () => {
    const fetcher = vi.fn(async () => new Response('{}', { status: 200 }));
    const client = createZapLeadClient({
      baseUrl: 'https://zap.example.test',
      keyId: 'ak_000000000000000000000000',
      secret: 'test_secret_for_local_fixture_0001',
      fetcher,
    });

    await expect(
      client.request('POST', '/api/agency/v1/leads', { name: 'Fictício' })
    ).rejects.toThrow('Zap Lead write requests require an idempotency key');
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('trims idempotency keys and enforces the Zap Lead printable ASCII limits', async () => {
    let sentInit: RequestInit | undefined;
    const fetcher = vi.fn(async (_url: URL, init: RequestInit) => {
      sentInit = init;
      return new Response('{}', { status: 200 });
    });
    const client = createZapLeadClient({
      baseUrl: 'https://zap.example.test',
      keyId: 'ak_000000000000000000000000',
      secret: 'test_secret_for_local_fixture_0001',
      fetcher,
    });
    const request = (idempotencyKey: string) =>
      client.request('POST', '/api/agency/v1/leads', {}, { idempotencyKey });

    await request(`  ${'k'.repeat(128)}  `);
    expect(new Headers(sentInit?.headers).get('Idempotency-Key')).toBe(
      'k'.repeat(128)
    );

    await request('!');
    expect(new Headers(sentInit?.headers).get('Idempotency-Key')).toBe('!');

    for (const invalidKey of [
      '   ',
      'key with space',
      'ação',
      'k'.repeat(129),
    ]) {
      await expect(request(invalidKey)).rejects.toThrow(
        'Invalid Zap Lead idempotency key'
      );
    }
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it('supports signed PUT and reuses an idempotency key with a fresh nonce on replay', async () => {
    const signedRequests: Array<{
      url: string;
      method: string | undefined;
      headers: Headers;
    }> = [];
    const fetcher = vi.fn(async (url: URL, init: RequestInit) => {
      signedRequests.push({
        url: url.toString(),
        method: init.method,
        headers: new Headers(init.headers),
      });
      return new Response('{}', { status: 200 });
    });
    let nonceIndex = 0;
    const client = createZapLeadClient({
      baseUrl: 'https://zap.example.test',
      keyId: 'ak_000000000000000000000000',
      secret: 'test_secret_for_local_fixture_0001',
      fetcher,
      nonce: () => `nonce-replay-${++nonceIndex}`,
      now: () => new Date('2026-10-13T12:34:56.000Z'),
    });

    await client.request(
      'PUT',
      '/api/agency/v1/modules/triage',
      { enabled: true },
      {
        idempotencyKey: 'req-20261013-command-0002',
      }
    );
    await client.request(
      'PUT',
      '/api/agency/v1/modules/triage',
      { enabled: true },
      {
        idempotencyKey: 'req-20261013-command-0002',
      }
    );

    expect(signedRequests.map((request) => request.method)).toEqual([
      'PUT',
      'PUT',
    ]);
    expect(
      signedRequests.map((request) => request.headers.get('Idempotency-Key'))
    ).toEqual(['req-20261013-command-0002', 'req-20261013-command-0002']);
    expect(
      signedRequests.map((request) => request.headers.get('X-Agency-Nonce'))
    ).toEqual(['nonce-replay-1', 'nonce-replay-2']);
    const bodyHash = createHash('sha256')
      .update(JSON.stringify({ enabled: true }), 'utf8')
      .digest('hex');
    const canonical = [
      'PUT',
      '/api/agency/v1/modules/triage',
      '2026-10-13T12:34:56.000Z',
      'nonce-replay-1',
      bodyHash,
    ].join('\n');
    const expectedSignature = createHmac(
      'sha256',
      'test_secret_for_local_fixture_0001'
    )
      .update(canonical, 'utf8')
      .digest('hex');
    expect(signedRequests[0].headers.get('X-Agency-Signature')).toBe(
      expectedSignature
    );
    expect(signedRequests[0].headers.get('X-Agency-Signature')).not.toBe(
      signedRequests[1].headers.get('X-Agency-Signature')
    );
  });

  it('does not return response bodies on HTTP errors', async () => {
    const fetcher = vi.fn(
      async () => new Response('sensitive remote detail', { status: 503 })
    );
    const client = createZapLeadClient({
      baseUrl: 'https://zap.example.test',
      keyId: 'ak_000000000000000000000000',
      secret: 'test_secret_for_local_fixture_0001',
      fetcher,
      nonce: () => 'nonce-test-001',
    });

    await expect(
      client.request('GET', '/api/agency/v1/health')
    ).rejects.toThrow('Zap Lead API request failed (503)');
  });

  it('opens a signed SSE stream with the resume cursor in the signed target', async () => {
    let sentUrl: URL | undefined;
    let sentInit: RequestInit | undefined;
    const fetcher = vi.fn(async (url: URL, init: RequestInit) => {
      sentUrl = url;
      sentInit = init;
      return new Response('event: ready\ndata: {}\n\n', {
        headers: { 'content-type': 'text/event-stream; charset=utf-8' },
      });
    });
    const client = createZapLeadClient({
      baseUrl: 'https://zap.example.test',
      keyId: 'ak_000000000000000000000000',
      secret: 'test_secret_for_local_fixture_0001',
      fetcher,
      nonce: () => 'nonce-sse-001',
      now: () => new Date('2026-10-13T12:34:56.000Z'),
    });
    const cursor = '18fae01a-a5b8-4a7e-95af-453810e49dc9';

    const response = await client.openEvents(cursor);

    const url = sentUrl as URL;
    const init = sentInit as RequestInit;
    const headers = new Headers(init.headers);
    const target = '/api/agency/v1/events/stream?cursor=' + cursor;
    const bodyHash = createHash('sha256').update('').digest('hex');
    const canonical = [
      'GET',
      target,
      '2026-10-13T12:34:56.000Z',
      'nonce-sse-001',
      bodyHash,
    ].join('\n');
    const expectedSignature = createHmac(
      'sha256',
      'test_secret_for_local_fixture_0001'
    )
      .update(canonical, 'utf8')
      .digest('hex');

    expect(response.headers.get('content-type')).toContain('text/event-stream');
    expect(url.toString()).toBe('https://zap.example.test' + target);
    expect(init.method).toBe('GET');
    expect(init.body).toBeUndefined();
    expect(headers.get('Accept')).toBe('text/event-stream');
    expect(headers.get('X-Agency-Signature')).toBe(expectedSignature);
    expect(init.cache).toBe('no-store');
    expect(init.redirect).toBe('error');
  });

  it('rejects malformed SSE cursors before making a request', async () => {
    const fetcher = vi.fn(async () => new Response());
    const client = createZapLeadClient({
      baseUrl: 'https://zap.example.test',
      keyId: 'ak_000000000000000000000000',
      secret: 'test_secret_for_local_fixture_0001',
      fetcher,
    });

    await expect(client.openEvents('not-a-uuid')).rejects.toThrow(
      'Invalid Zap Lead event cursor'
    );
    expect(fetcher).not.toHaveBeenCalled();
  });
});
