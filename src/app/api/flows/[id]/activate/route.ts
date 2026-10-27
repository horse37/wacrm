import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { toAppError } from '@/lib/db/errors';
import { createPostgresFlowStatusTransitionRepository } from '@/lib/repositories/flow-status-transition';
import type { FlowStatus } from '@/lib/repositories/flow-status-transition';

/**
 * POST /api/flows/[id]/activate
 *
 * Body: { status: 'draft' | 'active' | 'archived' }
 *
 * The PostgreSQL repository validates activation and applies the status change
 * inside one account-scoped transaction.
 */
export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> }
) {
  const { id } = await context.params;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const body = (await request.json().catch(() => null)) as {
    status?: FlowStatus;
  } | null;
  const status = body?.status;
  if (!status || !['draft', 'active', 'archived'].includes(status)) {
    return NextResponse.json(
      { error: "status must be one of 'draft' | 'active' | 'archived'" },
      { status: 400 }
    );
  }

  const getVerifiedSession = async () => ({ userId: user.id });
  const repository =
    createPostgresFlowStatusTransitionRepository(getVerifiedSession);

  try {
    const result = await repository.transitionForFlow(id, status);
    if (
      status === 'active' &&
      result.issues.some((issue) => issue.severity === 'error')
    ) {
      return NextResponse.json(
        {
          error: 'Cannot activate flow — fix the issues below first.',
          issues: result.issues,
        },
        { status: 422 }
      );
    }

    return NextResponse.json({
      flow: { id: result.flowId, status: result.status },
    });
  } catch (error) {
    const appError = toAppError(error);
    if (appError.code === 'unauthorized') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    if (appError.code === 'forbidden') {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }
    if (appError.code === 'not_found' || appError.code === 'bad_request') {
      return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }

    console.error('[flows/activate] PostgreSQL status update failed');
    return NextResponse.json(
      { error: 'Failed to update flow status' },
      { status: 500 }
    );
  }
}
