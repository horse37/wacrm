// ============================================================
// DELETE /api/account/invitations/[id]
//
// Admin+. Revokes a pending invitation by id. The PostgreSQL
// account guard scopes the delete to the caller's account.
//
// We intentionally delete the row outright rather than soft-
// deleting (a `revoked_at` flag). Once revoked, an invite is
// dead forever — there's no UX where a former invite should be
// listed; the plaintext token is gone too. Hard delete keeps
// the table small.
// ============================================================

import { NextResponse } from 'next/server';

import { requireRole, toErrorResponse } from '@/lib/auth/account';
import { toAppError } from '@/lib/db/errors';
import { createPostgresAccountInvitationsRepository } from '@/lib/repositories/account-invitations';
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
    console.error(
      '[DELETE /api/account/invitations/[id]] PostgreSQL delete error:',
      error
    );
    return NextResponse.json(
      { error: 'Failed to revoke invitation' },
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

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const ctx = await requireRole('admin');

    const limit = checkRateLimit(
      `admin:inviteRevoke:${ctx.userId}`,
      RATE_LIMITS.adminAction
    );
    if (!limit.success) return rateLimitResponse(limit);

    const { id } = await params;
    const repository = createPostgresAccountInvitationsRepository(async () => ({
      userId: ctx.userId,
    }));

    let revoked: boolean;
    try {
      revoked = await repository.revoke(id);
    } catch (error) {
      return repositoryErrorToResponse(error);
    }

    if (!revoked) {
      return NextResponse.json(
        { error: 'Invitation not found' },
        { status: 404 }
      );
    }

    return NextResponse.json({ ok: true });
  } catch (error) {
    return toErrorResponse(error);
  }
}
