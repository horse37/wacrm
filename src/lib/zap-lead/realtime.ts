export interface ZapLeadSseReceipt {
  eventId: string;
  eventType: 'conversation.message.created' | 'lead.stage.changed';
  occurredAt: string;
}

const UUID =
  /^[\da-f]{8}-[\da-f]{4}-[1-8][\da-f]{3}-[89ab][\da-f]{3}-[\da-f]{12}$/i;
const RFC3339_TIMESTAMP =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/i;
const MAX_FRAME_LENGTH = 64 * 1024;

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function hasExactKeys(value: Record<string, unknown>, expected: string[]) {
  return Object.keys(value).sort().join(',') === expected.sort().join(',');
}

function isUuid(value: unknown): value is string {
  return typeof value === 'string' && UUID.test(value);
}

export function parseZapLeadSseBlock(block: string): ZapLeadSseReceipt | null {
  let id: string | undefined;
  let eventName: string | undefined;
  const dataLines: string[] = [];

  for (const line of block.replace(/\r\n?/g, '\n').split('\n')) {
    if (!line || line.startsWith(':')) continue;
    const separator = line.indexOf(':');
    const field = separator < 0 ? line : line.slice(0, separator);
    const value =
      separator < 0 ? '' : line.slice(separator + 1).replace(/^ /, '');
    if (field === 'id') {
      if (id !== undefined) return null;
      id = value;
    } else if (field === 'event') {
      if (eventName !== undefined) return null;
      eventName = value;
    } else if (field === 'data') {
      dataLines.push(value);
    }
  }

  if (!eventName || eventName === 'ready' || dataLines.length === 0)
    return null;

  let payload: unknown;
  try {
    payload = JSON.parse(dataLines.join('\n')) as unknown;
  } catch {
    return null;
  }
  if (!isRecord(payload)) return null;

  const commonKeys = ['apiVersion', 'eventId', 'eventType', 'occurredAt'];
  if (
    payload.apiVersion !== '1.0.0' ||
    !isUuid(payload.eventId) ||
    payload.eventId !== id ||
    payload.eventType !== eventName ||
    typeof payload.occurredAt !== 'string' ||
    !RFC3339_TIMESTAMP.test(payload.occurredAt) ||
    !Number.isFinite(Date.parse(payload.occurredAt))
  ) {
    return null;
  }

  if (
    eventName === 'conversation.message.created' &&
    hasExactKeys(payload, [...commonKeys, 'conversationId', 'messageId']) &&
    isUuid(payload.conversationId) &&
    isUuid(payload.messageId)
  ) {
    return {
      eventId: payload.eventId,
      eventType: eventName,
      occurredAt: payload.occurredAt,
    };
  }

  if (
    eventName === 'lead.stage.changed' &&
    hasExactKeys(payload, [...commonKeys, 'leadId', 'stageId']) &&
    isUuid(payload.leadId) &&
    isUuid(payload.stageId)
  ) {
    return {
      eventId: payload.eventId,
      eventType: eventName,
      occurredAt: payload.occurredAt,
    };
  }

  return null;
}

export class ZapLeadSseParser {
  private buffer = '';

  push(chunk: string): ZapLeadSseReceipt[] {
    this.buffer += chunk;
    const hasTrailingCarriageReturn = this.buffer.endsWith('\r');
    const completeInput = hasTrailingCarriageReturn
      ? this.buffer.slice(0, -1)
      : this.buffer;
    const frames = completeInput.replace(/\r\n?/g, '\n').split('\n\n');
    this.buffer = frames.pop() ?? '';
    if (hasTrailingCarriageReturn) this.buffer += '\r';

    if (this.buffer.length > MAX_FRAME_LENGTH) {
      throw new Error('Zap Lead SSE frame exceeds the allowed size');
    }

    return frames.flatMap((frame) => {
      if (frame.length > MAX_FRAME_LENGTH) {
        throw new Error('Zap Lead SSE frame exceeds the allowed size');
      }
      const event = parseZapLeadSseBlock(frame);
      return event ? [event] : [];
    });
  }
}
