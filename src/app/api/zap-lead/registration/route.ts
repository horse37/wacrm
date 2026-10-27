import { NextResponse } from 'next/server';

import { requireRole, toErrorResponse } from '@/lib/auth/account';
import { createPostgresZapLeadRegistrationReadRepository } from '@/lib/repositories/zap-lead-registration-read';
import {
  checkRateLimit,
  rateLimitResponse,
  RATE_LIMITS,
} from '@/lib/rate-limit';
import {
  removeZapLeadCredentials,
  saveZapLeadCredentials,
} from '@/lib/zap-lead/credentials';
import { generateZapLeadRegistration } from '@/lib/zap-lead/registration';

export const runtime = 'nodejs';

function normalizeOrigin(value: unknown): string | null {
  if (typeof value !== 'string' || value.length > 2048) return null;

  try {
    const url = new URL(value);
    if (
      url.protocol !== 'https:' ||
      url.username ||
      url.password ||
      url.search ||
      url.hash ||
      (url.pathname !== '/' && url.pathname !== '')
    ) {
      return null;
    }
    return url.origin;
  } catch {
    return null;
  }
}

function getWebhookUrl(): string | null {
  const publicOrigin = normalizeOrigin(process.env.NEXT_PUBLIC_SITE_URL);
  return publicOrigin ? `${publicOrigin}/api/zap-lead/webhook` : null;
}

export async function GET() {
  try {
    const account = await requireRole('admin');
    const repository = createPostgresZapLeadRegistrationReadRepository({
      userId: account.userId,
      accountId: account.accountId,
    });

    let integration;
    try {
      integration = await repository.getIntegration();
    } catch {
      return NextResponse.json(
        { error: 'Could not load Zap Lead integration status' },
        { status: 500 }
      );
    }

    if (!integration) {
      return NextResponse.json({
        configured: false,
        apiBaseUrl: null,
        generation: null,
        heartbeat: {
          lastSuccessAt: null,
          lastFailureAt: null,
          lastErrorCode: null,
          alertSentAt: null,
        },
      });
    }

    let state;
    try {
      state = await repository.getHeartbeatState(integration.keyId);
    } catch {
      return NextResponse.json(
        { error: 'Could not load Zap Lead heartbeat status' },
        { status: 500 }
      );
    }

    return NextResponse.json({
      configured: true,
      apiBaseUrl: integration.apiBaseUrl,
      generation: integration.keyId,
      heartbeat: {
        lastSuccessAt: state?.lastSuccessAt ?? null,
        lastFailureAt: state?.lastFailureAt ?? null,
        lastErrorCode: state?.lastErrorCode ?? null,
        alertSentAt: state?.alertSentAt ?? null,
      },
    });
  } catch (error) {
    return toErrorResponse(error);
  }
}

export async function POST(request: Request) {
  try {
    const account = await requireRole('admin');
    const limit = checkRateLimit(
      `zap-lead-registration:${account.userId}`,
      RATE_LIMITS.adminAction
    );
    if (!limit.success) return rateLimitResponse(limit);

    const body = await request.json().catch(() => null);
    const apiBaseUrl = normalizeOrigin(body?.apiBaseUrl);
    if (!apiBaseUrl) {
      return NextResponse.json(
        { error: 'Enter a valid HTTPS Zap Lead origin' },
        { status: 400 }
      );
    }

    const webhookUrl = getWebhookUrl();
    if (!webhookUrl) {
      return NextResponse.json(
        { error: 'Configure NEXT_PUBLIC_SITE_URL as the public HTTPS origin' },
        { status: 503 }
      );
    }

    const registrationCode = generateZapLeadRegistration(webhookUrl);
    await saveZapLeadCredentials(registrationCode, apiBaseUrl);

    return NextResponse.json(
      { registrationCode, webhookUrl },
      { status: 201, headers: { 'Cache-Control': 'no-store' } }
    );
  } catch (error) {
    return toErrorResponse(error);
  }
}

export async function DELETE() {
  try {
    await removeZapLeadCredentials();
    return new Response(null, { status: 204 });
  } catch (error) {
    return toErrorResponse(error);
  }
}
