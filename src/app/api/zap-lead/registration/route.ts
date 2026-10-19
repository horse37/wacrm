import { NextResponse } from 'next/server';

import { requireRole, toErrorResponse } from '@/lib/auth/account';
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
    const { data, error } = await account.supabase
      .from('zap_lead_integrations')
      .select('api_base_url, key_id')
      .eq('account_id', account.accountId)
      .maybeSingle();

    if (error) {
      return NextResponse.json(
        { error: 'Could not load Zap Lead integration status' },
        { status: 500 }
      );
    }

    if (!data) {
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

    const { data: state, error: stateError } = await account.supabase
      .from('zap_lead_integration_state')
      .select(
        'last_success_at, last_failure_at, last_error_code, alert_sent_at'
      )
      .eq('account_id', account.accountId)
      .eq('integration_key_id', data.key_id)
      .maybeSingle();
    if (stateError) {
      return NextResponse.json(
        { error: 'Could not load Zap Lead heartbeat status' },
        { status: 500 }
      );
    }

    return NextResponse.json({
      configured: true,
      apiBaseUrl: data.api_base_url,
      generation: data.key_id,
      heartbeat: {
        lastSuccessAt: state?.last_success_at ?? null,
        lastFailureAt: state?.last_failure_at ?? null,
        lastErrorCode: state?.last_error_code ?? null,
        alertSentAt: state?.alert_sent_at ?? null,
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
