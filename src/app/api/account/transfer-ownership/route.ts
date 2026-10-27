// ============================================================
// POST /api/account/transfer-ownership
//
// Owner only. Atomically:
//   - demotes the current owner to 'admin'
//   - promotes the target member to 'owner'
//   - updates accounts.owner_user_id
//
// The atomic part lives in the `transfer_account_ownership`
// SECURITY DEFINER RPC (migration 018). This route just validates
// shape and forwards.
//
// Why a separate endpoint instead of PATCH /members/[userId]?
//   The semantics differ: transfer demotes the current owner as
//   a side-effect and changes the owner_user_id pointer on
//   `accounts`. Making it explicit prevents the "I clicked the
//   role dropdown by mistake" failure mode where an admin would
//   silently hand their account away.
// ============================================================

import { NextResponse } from 'next/server';

import { requireRole, toErrorResponse } from '@/lib/auth/account';
import { toAppError } from '@/lib/db/errors';
import { createPostgresAccountOwnershipTransferRepository } from '@/lib/repositories/account-ownership-transfer';
import {
  checkRateLimit,
  rateLimitResponse,
  RATE_LIMITS,
} from '@/lib/rate-limit';

function repositoryErrorToResponse(error: unknown): NextResponse {
  const appError = toAppError(error);
  if (appError.sqlState === '42501') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }
  if (appError.code === 'db_error') {
    console.error('[transfer-ownership] unexpected repository error:', error);
    return NextResponse.json(
      { error: 'Failed to transfer ownership' },
      { status: 500 }
    );
  }

  const statusByCode = {
    unauthorized: 401,
    forbidden: 403,
    bad_request: 400,
    not_found: 404,
    conflict: 409,
  } as const;

  return NextResponse.json(
    { error: appError.message },
    { status: statusByCode[appError.code] }
  );
}

// Crude shape check — full UUID validation happens DB-side when
// the FK / lookup runs. This guards against obviously-wrong input
// (numbers, objects) before we round-trip.
function looksLikeUuid(v: unknown): v is string {
  return (
    typeof v === 'string' &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v)
  );
}

export async function POST(request: Request) {
  try {
    // Keep the existing Auth guard. The PostgreSQL repository also
    // verifies the owner role before it starts the transfer.
    const ctx = await requireRole('owner');

    // Rate-limit owner-only transfers. Legitimate use is one click
    // every few months at most; a script run in a loop would
    // produce a noisy audit trail. 30/min is well above any human
    // pace and bounds the noise.
    const limit = checkRateLimit(
      `admin:transferOwnership:${ctx.userId}`,
      RATE_LIMITS.adminAction
    );
    if (!limit.success) return rateLimitResponse(limit);

    const body = (await request.json().catch(() => null)) as {
      newOwnerUserId?: unknown;
    } | null;
    const newOwnerUserId = body?.newOwnerUserId;

    if (!looksLikeUuid(newOwnerUserId)) {
      return NextResponse.json(
        { error: "'newOwnerUserId' must be a valid UUID" },
        { status: 400 }
      );
    }

    const repository = createPostgresAccountOwnershipTransferRepository(
      async () => ({ userId: ctx.userId })
    );
    try {
      await repository.transferTo(newOwnerUserId);
    } catch (error) {
      return repositoryErrorToResponse(error);
    }

    return NextResponse.json({ ok: true });
  } catch (err) {
    return toErrorResponse(err);
  }
}
