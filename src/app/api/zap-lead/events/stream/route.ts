import { getZapLeadEventStreamTargetForCurrentAccount } from '@/lib/zap-lead/credentials';
import { toErrorResponse } from '@/lib/auth/account';
import { recordZapLeadSseEvent } from '@/lib/zap-lead/events';
import { ZapLeadSseParser } from '@/lib/zap-lead/realtime';
import { isValidZapLeadEventCursor } from '@/lib/zap-lead/client';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

function errorResponse(status: number, error: string): Response {
  return Response.json(
    { error },
    { status, headers: { 'Cache-Control': 'no-store' } }
  );
}

export async function GET(request: Request): Promise<Response> {
  let target: Awaited<
    ReturnType<typeof getZapLeadEventStreamTargetForCurrentAccount>
  >;
  try {
    target = await getZapLeadEventStreamTargetForCurrentAccount();
  } catch (error) {
    return toErrorResponse(error);
  }
  if (!target) return errorResponse(409, 'Zap Lead is not configured');

  const clientCursor = request.headers.get('last-event-id');
  let cursor = target.cursor;
  if (clientCursor !== null) {
    const scopedCursor = /^(ak_[\da-f]{24}):([\da-f-]+)$/i.exec(clientCursor);
    if (scopedCursor) {
      const [, cursorKeyId, eventCursor] = scopedCursor;
      if (!isValidZapLeadEventCursor(eventCursor)) {
        return errorResponse(400, 'Zap Lead event cursor is invalid');
      }
      if (cursorKeyId.toLowerCase() === target.keyId.toLowerCase()) {
        cursor = eventCursor;
      }
    } else if (!isValidZapLeadEventCursor(clientCursor)) {
      return errorResponse(400, 'Zap Lead event cursor is invalid');
    }
    // Bare UUIDs are cursors from the previous unscoped protocol. Ignore them
    // and resume from the current installation's stored cursor.
  }

  let upstream: Response;
  try {
    upstream = await target.client.openEvents(cursor, request.signal);
  } catch {
    return errorResponse(503, 'Zap Lead event stream is unavailable');
  }

  if (!upstream.body) {
    return errorResponse(502, 'Zap Lead event stream returned no body');
  }

  const reader = upstream.body.getReader();
  const parser = new ZapLeadSseParser();
  const decoder = new TextDecoder();
  const encoder = new TextEncoder();
  let controller: ReadableStreamDefaultController<Uint8Array> | null = null;
  let closed = false;
  let expectedCursor = cursor;

  const close = () => {
    if (closed) return;
    closed = true;
    request.signal.removeEventListener('abort', close);
    try {
      controller?.close();
    } catch {
      // The local EventSource already disconnected.
    }
    void reader.cancel().catch(() => undefined);
  };

  const stream = new ReadableStream<Uint8Array>({
    start(streamController) {
      controller = streamController;
      request.signal.addEventListener('abort', close, { once: true });
      controller.enqueue(
        encoder.encode('retry: 3000\nevent: ready\ndata: {}\n\n')
      );

      void (async () => {
        try {
          while (!closed) {
            const chunk = await reader.read();
            if (chunk.done) {
              const trailing = decoder.decode();
              if (trailing) {
                parser.push(trailing);
              }
              close();
              return;
            }

            const text = decoder.decode(chunk.value, { stream: true });
            for (const event of parser.push(text)) {
              const result = await recordZapLeadSseEvent(
                {
                  accountId: target.accountId,
                  keyId: target.keyId,
                  eventId: event.eventId,
                  eventType: event.eventType,
                  occurredAt: event.occurredAt,
                },
                expectedCursor
              );
              if (result === 'invalid') {
                controller?.enqueue(
                  encoder.encode('event: resync\ndata: {}\n\n')
                );
                close();
                return;
              }
              // A sibling browser can advance the shared cursor first. Keep
              // this stream's independently requested event for its client.
              expectedCursor = event.eventId;
              if (!closed) {
                controller?.enqueue(
                  encoder.encode(
                    `id: ${target.keyId}:${event.eventId}\nevent: ${event.eventType}\ndata: ${JSON.stringify(event)}\n\n`
                  )
                );
              }
            }
          }
        } catch {
          if (!closed) {
            try {
              controller?.enqueue(
                encoder.encode('event: resync\ndata: {}\n\n')
              );
            } catch {
              // The local EventSource already disconnected.
            }
            close();
          }
        }
      })();
    },
    cancel() {
      close();
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    },
  });
}
