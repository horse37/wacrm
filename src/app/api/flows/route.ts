import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { getFlowTemplate } from '@/lib/flows/templates';
import { toAppError } from '@/lib/db/errors';
import { createPostgresFlowListRepository } from '@/lib/repositories/flow-list';
import { createPostgresFlowCreatePersistenceRepository } from '@/lib/repositories/flow-create-persistence';
import type { FlowCreateInput } from '@/lib/repositories/flow-create-persistence';

/**
 * GET /api/flows — list the caller's flows.
 * POST /api/flows — create a new (draft) flow.
 *
 * Available to every authenticated user. The previous per-account
 * beta gate was removed when Flows went to soft-GA; the UI still
 * shows a "Beta" label so users know the surface is young, but the
 * routes themselves are open.
 */

async function requireUser(): Promise<
  | {
      ok: true;
      userId: string;
      supabase: Awaited<ReturnType<typeof createClient>>;
    }
  | { ok: false; status: number; body: { error: string } }
> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return { ok: false, status: 401, body: { error: 'Unauthorized' } };
  }
  return { ok: true, userId: user.id, supabase };
}

export async function GET() {
  const guard = await requireUser();
  if (!guard.ok) {
    return NextResponse.json(guard.body, { status: guard.status });
  }
  const repository = createPostgresFlowListRepository(async () => ({
    userId: guard.userId,
  }));
  try {
    const flows = await repository.listForCurrentAccount();
    return NextResponse.json({ flows });
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
}

export async function POST(request: Request) {
  const guard = await requireUser();
  if (!guard.ok) {
    return NextResponse.json(guard.body, { status: guard.status });
  }

  const body = (await request.json().catch(() => null)) as {
    name?: string;
    description?: string | null;
    trigger_type?: 'keyword' | 'first_inbound_message' | 'manual';
    trigger_config?: Record<string, unknown>;
    template_slug?: string;
  } | null;
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }
  if (body.name !== undefined && typeof body.name !== 'string') {
    return NextResponse.json({ error: 'name required' }, { status: 400 });
  }
  if (
    body.template_slug !== undefined &&
    typeof body.template_slug !== 'string'
  ) {
    return NextResponse.json(
      { error: 'Invalid template_slug' },
      { status: 400 }
    );
  }

  let input: FlowCreateInput;
  if (body.template_slug) {
    const template = getFlowTemplate(body.template_slug);
    if (!template) {
      return NextResponse.json(
        { error: 'Unknown template_slug "' + body.template_slug + '"' },
        { status: 400 }
      );
    }
    input = {
      name: body.name?.trim() || template.name,
      description: template.description,
      trigger_type: template.trigger_type,
      trigger_config: { ...template.trigger_config },
      entry_node_id: template.entry_node_id,
      nodes: template.nodes.map((node) => ({
        node_key: node.node_key,
        node_type: node.node_type,
        config: { ...node.config },
      })),
    };
  } else {
    if (!body.name?.trim()) {
      return NextResponse.json({ error: 'name required' }, { status: 400 });
    }
    input = {
      name: body.name.trim(),
      description: body.description ?? null,
      trigger_type: body.trigger_type ?? 'keyword',
      trigger_config: body.trigger_config ?? {},
    };
  }

  const repository = createPostgresFlowCreatePersistenceRepository(
    async () => ({
      userId: guard.userId,
    })
  );
  try {
    const id = await repository.createDraft(input);
    return NextResponse.json({ flow: { id } }, { status: 201 });
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
}
