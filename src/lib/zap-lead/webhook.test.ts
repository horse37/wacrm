import { createHash, createHmac } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  isZapLeadTimestampFresh,
  verifyZapLeadWebhookSignature,
} from './webhook';

const secret = 'test-secret-fixture-001';
const timestamp = '2026-10-13T12:34:56.000Z';
const nonce = 'nonce-test-00000001';
const body = Buffer.from('{"eventId":"evt"}', 'utf8');

function signature(payload = body) {
  const bodyHash = createHash('sha256').update(payload).digest('hex');
  const canonical = [
    'POST',
    '/api/zap-lead/webhook?source=zap',
    timestamp,
    nonce,
    bodyHash,
  ].join('\n');
  return createHmac('sha256', secret).update(canonical).digest('hex');
}

describe('Zap Lead webhook signature', () => {
  it('validates the raw bytes and exact method, path, and query', () => {
    expect(
      verifyZapLeadWebhookSignature({
        secret,
        method: 'POST',
        target: '/api/zap-lead/webhook?source=zap',
        timestamp,
        nonce,
        body,
        signature: signature(),
      })
    ).toBe(true);

    expect(
      verifyZapLeadWebhookSignature({
        secret,
        method: 'POST',
        target: '/api/zap-lead/webhook',
        timestamp,
        nonce,
        body,
        signature: signature(),
      })
    ).toBe(false);
  });

  it('rejects malformed signatures and signatures over changed body bytes', () => {
    expect(
      verifyZapLeadWebhookSignature({
        secret,
        method: 'POST',
        target: '/api/zap-lead/webhook?source=zap',
        timestamp,
        nonce,
        body,
        signature: 'not-hex',
      })
    ).toBe(false);
    expect(
      verifyZapLeadWebhookSignature({
        secret,
        method: 'POST',
        target: '/api/zap-lead/webhook?source=zap',
        timestamp,
        nonce,
        body: Buffer.from('{"eventId":"other"}', 'utf8'),
        signature: signature(),
      })
    ).toBe(false);
  });

  it('accepts RFC3339 timestamps only within the five-minute window', () => {
    const now = Date.parse(timestamp);
    expect(isZapLeadTimestampFresh(timestamp, now)).toBe(true);
    expect(isZapLeadTimestampFresh(timestamp, now + 5 * 60_000)).toBe(true);
    expect(isZapLeadTimestampFresh(timestamp, now + 5 * 60_000 + 1)).toBe(
      false
    );
    expect(isZapLeadTimestampFresh('yesterday', now)).toBe(false);
  });
});
