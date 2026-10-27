import { NextResponse } from 'next/server';

import { getZapLeadWebhookCredential } from '@/lib/zap-lead/credentials';
import { acceptZapLeadWebhookEvent } from '@/lib/zap-lead/events';
import {
  isZapLeadTimestampFresh,
  verifyZapLeadWebhookSignature,
} from '@/lib/zap-lead/webhook';

export const runtime = 'nodejs';

// Credential lookup and receipt persistence use server-only PostgreSQL paths.
// This gate does not provision runtime EXECUTE privileges for the receipt function.
const POSTGRES_CREDENTIAL_LOOKUP_ENABLED_ENV =
  'WACRM_ZAP_LEAD_WEBHOOK_POSTGRES_CREDENTIAL_LOOKUP_ENABLED';
const MAX_BODY_BYTES = 64 * 1024;
const RFC3339_TIMESTAMP =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/i;
const UUID =
  /^[\da-f]{8}-[\da-f]{4}-[1-8][\da-f]{3}-[89ab][\da-f]{3}-[\da-f]{12}$/i;
const EVENT_TYPES = new Set([
  'lead.created',
  'lead.stage.changed',
  'lead.stage.pending_confirmation',
  'response.deadline.exceeded',
  'lead.assigned',
  'seller.channel.disconnected',
  'analysis.completed',
]);

type AgencyEvent = {
  apiVersion: '1.0.0';
  eventId: string;
  eventType: string;
  occurredAt: string;
};

async function readBoundedBody(request: Request): Promise<Uint8Array | null> {
  const reader = request.body?.getReader();
  if (!reader) return new Uint8Array();

  const chunks: Uint8Array[] = [];
  let size = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > MAX_BODY_BYTES) {
      await reader.cancel();
      return null;
    }
    chunks.push(value);
  }

  const body = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return body;
}

function parseEvent(body: Uint8Array): AgencyEvent | null {
  let value: unknown;
  try {
    value = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(body));
  } catch {
    return null;
  }

  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const candidate = value as Record<string, unknown>;
  const keys = Object.keys(candidate).sort();
  if (
    keys.join(',') !== 'apiVersion,data,eventId,eventType,occurredAt,summary'
  ) {
    return null;
  }

  const occurredAt = candidate.occurredAt;
  const summary = candidate.summary;
  const eventType = candidate.eventType;
  const dataValue = candidate.data;
  if (
    candidate.apiVersion !== '1.0.0' ||
    typeof candidate.eventId !== 'string' ||
    !UUID.test(candidate.eventId) ||
    typeof eventType !== 'string' ||
    !EVENT_TYPES.has(eventType) ||
    typeof occurredAt !== 'string' ||
    !RFC3339_TIMESTAMP.test(occurredAt) ||
    !Number.isFinite(Date.parse(occurredAt)) ||
    typeof summary !== 'string' ||
    summary.length < 1 ||
    summary.length > 240 ||
    !dataValue ||
    typeof dataValue !== 'object' ||
    Array.isArray(dataValue)
  ) {
    return null;
  }

  const data = dataValue as Record<string, unknown>;
  const hasExactKeys = (...expected: string[]) =>
    Object.keys(data).sort().join(',') === expected.sort().join(',');
  const isId = (value: unknown): value is string =>
    typeof value === 'string' && UUID.test(value);
  const isIdOrNull = (value: unknown): value is string | null =>
    value === null || isId(value);

  let validData: boolean;
  switch (eventType) {
    case 'lead.created':
      validData =
        hasExactKeys('leadId', 'campaignId') &&
        isId(data.leadId) &&
        isIdOrNull(data.campaignId);
      break;
    case 'lead.stage.changed':
      validData =
        hasExactKeys('leadId', 'previousStageId', 'stageId') &&
        isId(data.leadId) &&
        isIdOrNull(data.previousStageId) &&
        isId(data.stageId);
      break;
    case 'lead.stage.pending_confirmation':
      validData =
        hasExactKeys('leadId', 'stageId') &&
        isId(data.leadId) &&
        isId(data.stageId);
      break;
    case 'response.deadline.exceeded':
      validData =
        hasExactKeys('leadId', 'assignmentId') &&
        isId(data.leadId) &&
        isId(data.assignmentId);
      break;
    case 'lead.assigned':
      validData =
        hasExactKeys('leadId', 'sellerId', 'departmentId') &&
        isId(data.leadId) &&
        isId(data.sellerId) &&
        isIdOrNull(data.departmentId);
      break;
    case 'seller.channel.disconnected':
      validData =
        hasExactKeys('sellerId', 'numberId') &&
        isId(data.sellerId) &&
        isId(data.numberId);
      break;
    case 'analysis.completed':
      validData =
        hasExactKeys('analysisId', 'status') &&
        isId(data.analysisId) &&
        (data.status === 'completed' || data.status === 'failed');
      break;
    default:
      validData = false;
  }
  if (!validData) return null;

  return {
    apiVersion: '1.0.0',
    eventId: candidate.eventId,
    eventType,
    occurredAt,
  };
}

function errorResponse(status: number, error: string) {
  return NextResponse.json({ error }, { status });
}

export async function POST(request: Request) {
  if (process.env[POSTGRES_CREDENTIAL_LOOKUP_ENABLED_ENV] !== '1') {
    return errorResponse(503, 'Zap Lead webhook is temporarily unavailable');
  }

  const keyId = request.headers.get('X-Zap-Key');
  const timestamp = request.headers.get('X-Zap-Timestamp');
  const nonce = request.headers.get('X-Zap-Nonce');
  const signature = request.headers.get('X-Zap-Signature');

  if (
    !keyId ||
    !timestamp ||
    !nonce ||
    !signature ||
    !/^[A-Za-z\d_-]{16,128}$/.test(nonce) ||
    !isZapLeadTimestampFresh(timestamp)
  ) {
    return errorResponse(401, 'Invalid Zap Lead webhook authentication');
  }

  const body = await readBoundedBody(request);
  if (!body) return errorResponse(413, 'Zap Lead webhook body is too large');

  const targetUrl = new URL(request.url);
  const target = `${targetUrl.pathname}${targetUrl.search}`;
  let credential;
  try {
    credential = await getZapLeadWebhookCredential(keyId);
  } catch {
    return errorResponse(503, 'Zap Lead webhook authentication is unavailable');
  }
  if (!credential) {
    return errorResponse(401, 'Invalid Zap Lead webhook authentication');
  }

  const webhookUrl = credential.registration.webhookUrl;
  if (!webhookUrl) {
    return errorResponse(401, 'Invalid Zap Lead webhook authentication');
  }
  const configuredUrl = new URL(webhookUrl);
  if (
    configuredUrl.pathname !== targetUrl.pathname ||
    !verifyZapLeadWebhookSignature({
      secret: credential.registration.secret,
      method: request.method,
      target,
      timestamp,
      nonce,
      body,
      signature,
    })
  ) {
    return errorResponse(401, 'Invalid Zap Lead webhook authentication');
  }

  const event = parseEvent(body);
  if (!event) return errorResponse(400, 'Invalid Zap Lead webhook event');
  if (!credential.registration.events.includes(event.eventType)) {
    return errorResponse(
      403,
      'Zap Lead webhook event is outside this installation scope'
    );
  }

  try {
    const result = await acceptZapLeadWebhookEvent({
      accountId: credential.accountId,
      keyId,
      nonce,
      eventId: event.eventId,
      eventType: event.eventType,
      occurredAt: event.occurredAt,
    });

    if (result === 'replay') {
      return errorResponse(409, 'Zap Lead webhook nonce was already used');
    }
    if (result === 'invalid') {
      return errorResponse(401, 'Invalid Zap Lead webhook authentication');
    }

    return NextResponse.json(
      { accepted: true, duplicate: result === 'duplicate' },
      { status: 200, headers: { 'Cache-Control': 'no-store' } }
    );
  } catch {
    return errorResponse(503, 'Could not accept Zap Lead webhook event');
  }
}
