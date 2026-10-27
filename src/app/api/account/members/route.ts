// ============================================================
// GET /api/account/members
//
// Lists every member of the caller's account. Any member can call
// it; email visibility is enforced by the PostgreSQL repository.
// ============================================================

import { NextResponse } from 'next/server';

import { getCurrentAccount, toErrorResponse } from '@/lib/auth/account';
import { toAppError } from '@/lib/db/errors';
import { createPostgresAccountMembersRepository } from '@/lib/repositories/account-members';

function repositoryErrorToResponse(error: unknown): NextResponse {
  const appError = toAppError(error);

  if (appError.sqlState === '42501') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  if (appError.code === 'db_error') {
    console.error('[GET /api/account/members] PostgreSQL fetch error:', error);
    return NextResponse.json(
      { error: 'Failed to load members' },
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
    const repository = createPostgresAccountMembersRepository(async () => ({
      userId: ctx.userId,
    }));

    try {
      const members = await repository.list();
      return NextResponse.json({ members });
    } catch (error) {
      return repositoryErrorToResponse(error);
    }
  } catch (err) {
    return toErrorResponse(err);
  }
}
