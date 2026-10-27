// ============================================================
// /api/account/members/[userId]
//
//   PATCH  — change a member's role.   Admin+.
//   DELETE — remove a member.          Admin+.
//
// PostgreSQL repositories delegate the atomic account operations to
// the existing SECURITY DEFINER RPCs from migration 018. The route
// keeps the existing Auth guard and request/response contract.
// ============================================================

import { NextResponse } from 'next/server';

import { requireRole, toErrorResponse } from '@/lib/auth/account';
import { isAccountRole } from '@/lib/auth/roles';
import { toAppError } from '@/lib/db/errors';
import { createPostgresAccountMemberRemovalRepository } from '@/lib/repositories/account-member-removal';
import { createPostgresAccountMemberRoleRepository } from '@/lib/repositories/account-member-role';
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
    console.error('[members route] unexpected repository error:', error);
    return NextResponse.json(
      { error: 'Failed to update member' },
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

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ userId: string }> }
) {
  try {
    const ctx = await requireRole('admin');

    const limit = checkRateLimit(
      `admin:memberRole:${ctx.userId}`,
      RATE_LIMITS.adminAction
    );
    if (!limit.success) return rateLimitResponse(limit);

    const { userId } = await params;

    const body = (await request.json().catch(() => null)) as {
      role?: unknown;
    } | null;
    const role = body?.role;

    if (!isAccountRole(role)) {
      return NextResponse.json(
        { error: "'role' must be one of owner, admin, agent, viewer" },
        { status: 400 }
      );
    }

    // The RPC blocks promotion to / demotion from owner, but
    // surface the friendlier 400 before calling the repository too.
    if (role === 'owner') {
      return NextResponse.json(
        {
          error:
            'Use POST /api/account/transfer-ownership to promote a member to owner',
        },
        { status: 400 }
      );
    }

    try {
      const repository = createPostgresAccountMemberRoleRepository(
        async () => ({ userId: ctx.userId })
      );
      await repository.setRole(userId, role);
    } catch (error) {
      return repositoryErrorToResponse(error);
    }

    return NextResponse.json({ ok: true });
  } catch (err) {
    return toErrorResponse(err);
  }
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ userId: string }> }
) {
  try {
    const ctx = await requireRole('admin');

    const limit = checkRateLimit(
      `admin:memberRemove:${ctx.userId}`,
      RATE_LIMITS.adminAction
    );
    if (!limit.success) return rateLimitResponse(limit);

    const { userId } = await params;

    let newPersonalAccountId: string;
    try {
      const repository = createPostgresAccountMemberRemovalRepository(
        async () => ({ userId: ctx.userId })
      );
      newPersonalAccountId = await repository.removeMember(userId);
    } catch (error) {
      return repositoryErrorToResponse(error);
    }

    return NextResponse.json({ ok: true, newPersonalAccountId });
  } catch (err) {
    return toErrorResponse(err);
  }
}
