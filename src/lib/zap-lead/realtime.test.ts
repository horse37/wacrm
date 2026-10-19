import { describe, expect, it } from 'vitest';
import { parseZapLeadSseBlock, ZapLeadSseParser } from './realtime';

const eventId = '18fae01a-a5b8-4a7e-95af-453810e49dc9';
const occurredAt = '2026-10-13T12:30:00.000Z';

function block(eventType: string, data: Record<string, unknown>, id = eventId) {
  return `id: ${id}\nevent: ${eventType}\ndata: ${JSON.stringify({
    apiVersion: '1.0.0',
    eventId: id,
    eventType,
    occurredAt,
    ...data,
  })}\n\n`;
}

describe('Zap Lead SSE parser', () => {
  it('returns only technical receipt fields for valid realtime event types', () => {
    expect(
      parseZapLeadSseBlock(
        block('conversation.message.created', {
          conversationId: 'c725b80f-3f64-4bcb-9020-92336bce6ebd',
          messageId: 'a725b80f-3f64-4bcb-9020-92336bce6ebd',
        })
      )
    ).toEqual({
      eventId,
      eventType: 'conversation.message.created',
      occurredAt,
    });
    expect(
      parseZapLeadSseBlock(
        block('lead.stage.changed', {
          leadId: 'c725b80f-3f64-4bcb-9020-92336bce6ebd',
          stageId: 'a725b80f-3f64-4bcb-9020-92336bce6ebd',
        })
      )
    ).toEqual({ eventId, eventType: 'lead.stage.changed', occurredAt });
  });

  it.each([
    block('ready', {}),
    block('conversation.message.created', {
      conversationId: 'not-a-uuid',
      messageId: 'a725b80f-3f64-4bcb-9020-92336bce6ebd',
    }),
    block('lead.stage.changed', {
      leadId: 'c725b80f-3f64-4bcb-9020-92336bce6ebd',
      stageId: 'a725b80f-3f64-4bcb-9020-92336bce6ebd',
      leakedPayload: 'must not be accepted',
    }),
    block('lead.stage.changed', {
      leadId: 'c725b80f-3f64-4bcb-9020-92336bce6ebd',
      stageId: 'a725b80f-3f64-4bcb-9020-92336bce6ebd',
    }).replace(`id: ${eventId}`, 'id: b725b80f-3f64-4bcb-9020-92336bce6ebd'),
  ])(
    'ignores non-business frames and rejects malformed or mismatched payloads',
    (value) => {
      expect(parseZapLeadSseBlock(value)).toBeNull();
    }
  );

  it('preserves frame boundaries across chunked SSE input', () => {
    const parser = new ZapLeadSseParser();
    const value = block('lead.stage.changed', {
      leadId: 'c725b80f-3f64-4bcb-9020-92336bce6ebd',
      stageId: 'a725b80f-3f64-4bcb-9020-92336bce6ebd',
    });
    const split = Math.floor(value.length / 2);

    expect(parser.push(value.slice(0, split))).toEqual([]);
    expect(parser.push(value.slice(split))).toEqual([
      { eventId, eventType: 'lead.stage.changed', occurredAt },
    ]);
  });

  it('preserves a CRLF boundary split between chunks', () => {
    const parser = new ZapLeadSseParser();
    const value = block('lead.stage.changed', {
      leadId: 'c725b80f-3f64-4bcb-9020-92336bce6ebd',
      stageId: 'a725b80f-3f64-4bcb-9020-92336bce6ebd',
    }).replace(/\n/g, '\r\n');
    const split = value.indexOf('\r\n') + 1;

    expect(parser.push(value.slice(0, split))).toEqual([]);
    expect(parser.push(value.slice(split))).toEqual([
      { eventId, eventType: 'lead.stage.changed', occurredAt },
    ]);
  });

  it('limits each frame instead of rejecting a batch of small frames', () => {
    const parser = new ZapLeadSseParser();
    const value = Array.from({ length: 400 }, (_, index) =>
      block(
        'lead.stage.changed',
        {
          leadId: 'c725b80f-3f64-4bcb-9020-92336bce6ebd',
          stageId: 'a725b80f-3f64-4bcb-9020-92336bce6ebd',
        },
        `18fae01a-a5b8-4a7e-95af-${index.toString(16).padStart(12, '0')}`
      )
    ).join('');

    expect(value.length).toBeGreaterThan(64 * 1024);
    expect(parser.push(value)).toHaveLength(400);
  });

  it('rejects a single oversized frame', () => {
    const parser = new ZapLeadSseParser();

    expect(() => parser.push(`data: ${'x'.repeat(64 * 1024)}\n\n`)).toThrow(
      'Zap Lead SSE frame exceeds the allowed size'
    );
  });
});
