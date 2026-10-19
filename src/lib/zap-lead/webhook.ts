import { createHash, createHmac, timingSafeEqual } from 'node:crypto';

const RFC3339_TIMESTAMP =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/i;
const SIGNATURE = /^[\da-f]{64}$/i;
const WEBHOOK_MAX_AGE_MS = 5 * 60_000;

export interface ZapLeadWebhookSignatureInput {
  secret: string;
  method: string;
  target: string;
  timestamp: string;
  nonce: string;
  body: Uint8Array;
  signature: string;
}

export function isZapLeadTimestampFresh(
  timestamp: string,
  nowMs = Date.now()
): boolean {
  if (!RFC3339_TIMESTAMP.test(timestamp)) return false;
  const timestampMs = Date.parse(timestamp);
  return (
    Number.isFinite(timestampMs) &&
    Math.abs(nowMs - timestampMs) <= WEBHOOK_MAX_AGE_MS
  );
}

export function verifyZapLeadWebhookSignature(
  input: ZapLeadWebhookSignatureInput
): boolean {
  if (!SIGNATURE.test(input.signature)) return false;
  const bodyHash = createHash('sha256').update(input.body).digest('hex');
  const canonical = [
    input.method.toUpperCase(),
    input.target,
    input.timestamp,
    input.nonce,
    bodyHash,
  ].join('\n');
  const expected = Buffer.from(
    createHmac('sha256', input.secret).update(canonical, 'utf8').digest('hex'),
    'hex'
  );
  const received = Buffer.from(input.signature, 'hex');
  return (
    received.length === expected.length && timingSafeEqual(received, expected)
  );
}
