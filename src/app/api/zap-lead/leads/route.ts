import { ZodError } from 'zod';
import { ForbiddenError, UnauthorizedError } from '@/lib/auth/account';
import { createZapLeadLeadForCurrentAccount } from '@/lib/zap-lead/leads';

export const dynamic = 'force-dynamic';

export async function POST(request: Request): Promise<Response> {
  if (
    !request.headers
      .get('content-type')
      ?.toLowerCase()
      .startsWith('application/json')
  ) {
    return Response.json({ error: 'invalid_request' }, { status: 400 });
  }

  const idempotencyKey = request.headers.get('idempotency-key');
  if (!idempotencyKey) {
    return Response.json({ error: 'invalid_request' }, { status: 400 });
  }

  let rawBody: string;
  try {
    rawBody = await request.text();
  } catch {
    return Response.json({ error: 'invalid_request' }, { status: 400 });
  }
  if (new TextEncoder().encode(rawBody).byteLength > 8_192) {
    return Response.json({ error: 'invalid_request' }, { status: 413 });
  }

  let body: unknown;
  try {
    body = JSON.parse(rawBody);
  } catch {
    return Response.json({ error: 'invalid_request' }, { status: 400 });
  }

  try {
    const leadId = await createZapLeadLeadForCurrentAccount(
      body,
      idempotencyKey
    );
    if (!leadId) {
      return Response.json(
        { error: 'zap_lead_not_configured' },
        { status: 404, headers: { 'Cache-Control': 'no-store' } }
      );
    }
    return Response.json(
      { created: true },
      { status: 201, headers: { 'Cache-Control': 'no-store' } }
    );
  } catch (error) {
    if (error instanceof UnauthorizedError || error instanceof ForbiddenError) {
      return Response.json({ error: error.message }, { status: error.status });
    }
    if (error instanceof ZodError) {
      return Response.json({ error: 'invalid_request' }, { status: 400 });
    }
    return Response.json(
      { error: 'zap_lead_unavailable' },
      { status: 502, headers: { 'Cache-Control': 'no-store' } }
    );
  }
}
