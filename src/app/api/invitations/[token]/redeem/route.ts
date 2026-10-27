// ============================================================
// POST /api/invitations/[token]/redeem
//
// Authenticated. Caller atomically moves from personal account
// to inviter's account and invite role through migration 019's
// PostgreSQL redeem_invitation RPC.
//
// The verified session check remains here for the existing 401
// response. PostgreSQL transaction-local identity is derived
// only from that verified user and passed to the repository.
// ============================================================
import { NextResponse } from 'next/server';

import { hashInviteToken } from '@/lib/auth/invitations';
import { toAppError } from '@/lib/db/errors';
import type { DbErrorCode } from '@/lib/db/errors';
import {
  checkRateLimit,
  rateLimitResponse,
  RATE_LIMITS,
} from '@/lib/rate-limit';
import { createPostgresInvitationRedemptionRepository } from '@/lib/repositories/invitation-redemption';
import { createClient } from '@/lib/supabase/server';

function getClientIp(request: Request): string {
  const xff = request.headers.get('x-forwarded-for');
  if (xff) return xff.split(',')[0].trim();
  const xri = request.headers.get('x-real-ip');
  if (xri) return xri.trim();
  return 'unknown';
}

function repositoryErrorToResponse(error: unknown): NextResponse {
  const appError = toAppError(error);
  const responseByCode = {
    unauthorized: { status: 401, error: 'Unauthorized' },
    forbidden: {
      status: 401,
      error: 'You are not allowed to accept this invitation.',
    },
    bad_request: {
      status: 400,
      error: 'This invitation is invalid, already used, or expired.',
    },
    not_found: {
      status: 400,
      error: 'This invitation is invalid, already used, or expired.',
    },
    conflict: {
      status: 409,
      error:
        'Your account cannot accept this invitation. Sign up with a different email to join this one.',
    },
    db_error: { status: 500, error: 'Failed to redeem invitation' },
  } satisfies Record<DbErrorCode, { status: number; error: string }>;

  if (appError.code === 'db_error') {
    console.error('[redeem] unexpected repository error:', error);
  }

  const response = responseByCode[appError.code];
  return NextResponse.json(
    { error: response.error },
    { status: response.status }
  );
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ token: string }> }
) {
  const ip = getClientIp(request);
  const limit = checkRateLimit(`redeem:${ip}`, RATE_LIMITS.invitationRedeem);
  if (!limit.success) return rateLimitResponse(limit);

  const { token } = await params;
  if (!token || typeof token !== 'string') {
    return NextResponse.json(
      { error: 'Missing invitation token' },
      { status: 400 }
    );
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const repository = createPostgresInvitationRedemptionRepository(async () => ({
    userId: user.id,
  }));
  try {
    const accountId = await repository.redeemByTokenHash(
      hashInviteToken(token)
    );
    return NextResponse.json({ ok: true, accountId });
  } catch (error) {
    return repositoryErrorToResponse(error);
  }
}
