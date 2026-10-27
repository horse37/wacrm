import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { toAppError } from '@/lib/db/errors';
import { createPostgresFlowRunEventListRepository } from '@/lib/repositories/flow-run-event-list';
import type { FlowRunEventListItem } from '@/lib/repositories/flow-run-event-list';
import { createPostgresFlowRunListRepository } from '@/lib/repositories/flow-run-list';

/**
 * GET /api/flows/[id]/runs
 *
 * Newest-first list of flow runs for a single flow with event timelines.
 * Used by the run-history viewer page (`/flows/[id]/runs`). The
 * PostgreSQL repositories enforce verified-account scope.
 *
 * Limited to the 50 most recent runs. Pagination can come later;
 * the dashboard surface here is for debugging, not heavy querying.
 */
export async function GET(
  _request: Request,
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

  const getVerifiedSession = async () => ({ userId: user.id });
  const runRepository = createPostgresFlowRunListRepository(getVerifiedSession);

  let history: Awaited<ReturnType<typeof runRepository.listForFlow>>;
  try {
    history = await runRepository.listForFlow(id);
  } catch (error) {
    const appError = toAppError(error);
    const status = {
      unauthorized: 401,
      forbidden: 403,
      bad_request: 400,
      not_found: 404,
      conflict: 409,
      db_error: 500,
    }[appError.code];
    return NextResponse.json({ error: appError.message }, { status });
  }

  let events: FlowRunEventListItem[] = [];
  if (history.runs.length > 0) {
    const eventRepository =
      createPostgresFlowRunEventListRepository(getVerifiedSession);
    try {
      events = await eventRepository.listForFlow(id);
    } catch (error) {
      // Non-fatal — the page can still show runs without timelines.
      console.error(
        '[flows-runs] events fetch failed:',
        toAppError(error).message
      );
    }
  }

  return NextResponse.json({ ...history, events });
}
