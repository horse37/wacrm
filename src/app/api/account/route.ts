// ============================================================
// /api/account
//
//   GET   — current caller's account + role. Any member.
//   PATCH — rename the account.                  Admin+.
//
// Why both verbs share a route file
//   They speak about the same singular resource (the caller's
//   account) and reuse the same `requireRole` plumbing. Splitting
//   them across files would duplicate the `account_id` lookup
//   without buying anything.
// ============================================================

import { NextResponse } from 'next/server';

import {
  requireRole,
  getCurrentAccount,
  toErrorResponse,
} from '@/lib/auth/account';
import { toAppError } from '@/lib/db/errors';
import { createPostgresAccountRepository } from '@/lib/repositories/accounts';
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
    console.error('[PATCH /api/account] PostgreSQL update error:', error);
    return NextResponse.json(
      { error: 'Failed to update account' },
      { status: 500 }
    );
  }

  const statusByCode = {
    unauthorized: 401,
    forbidden: 403,
    bad_request: 400,
    not_found: 404,
    conflict: 409,
    db_error: 500,
  } as const;

  return NextResponse.json(
    { error: appError.message },
    { status: statusByCode[appError.code] }
  );
}

export async function GET() {
  try {
    const ctx = await getCurrentAccount();
    return NextResponse.json({
      account: ctx.account,
      role: ctx.role,
    });
  } catch (err) {
    return toErrorResponse(err);
  }
}

const MAX_NAME_LEN = 80;

export async function PATCH(request: Request) {
  try {
    const ctx = await requireRole('admin');

    // Per-user limit on admin-class mutations. Bounds accidental
    // abuse (script run in a loop) and a compromised admin session
    // spamming renames. Each admin endpoint keys its own bucket so
    // one route doesn't starve another.
    const limit = checkRateLimit(
      `admin:rename:${ctx.userId}`,
      RATE_LIMITS.adminAction
    );
    if (!limit.success) return rateLimitResponse(limit);

    const body = (await request.json().catch(() => null)) as {
      name?: unknown;
    } | null;
    const rawName = body?.name;

    if (typeof rawName !== 'string') {
      return NextResponse.json(
        { error: "'name' must be a string" },
        { status: 400 }
      );
    }

    const name = rawName.trim();
    if (name.length === 0) {
      return NextResponse.json(
        { error: 'Account name cannot be empty' },
        { status: 400 }
      );
    }
    if (name.length > MAX_NAME_LEN) {
      return NextResponse.json(
        { error: `Account name must be ${MAX_NAME_LEN} characters or fewer` },
        { status: 400 }
      );
    }

    try {
      const repository = createPostgresAccountRepository(async () => ({
        userId: ctx.userId,
      }));
      const updatedAccount = await repository.rename(name);
      return NextResponse.json({ account: updatedAccount });
    } catch (error) {
      return repositoryErrorToResponse(error);
    }
  } catch (err) {
    return toErrorResponse(err);
  }
}
