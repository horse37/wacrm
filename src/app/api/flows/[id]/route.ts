import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { toAppError } from '@/lib/db/errors';
import type { FlowHeaderPatch } from '@/lib/repositories/flow-header-update';
import { createPostgresFlowHeaderUpdateRepository } from '@/lib/repositories/flow-header-update';
import type { FlowNodeReplacementInput } from '@/lib/repositories/flow-node-graph-replace';
import { createPostgresFlowNodeGraphReplaceRepository } from '@/lib/repositories/flow-node-graph-replace';
import { createPostgresFlowEditorLoadRepository } from '@/lib/repositories/flow-editor-load';
import { createPostgresFlowDeletePersistenceRepository } from '@/lib/repositories/flow-delete-persistence';

/**
 * GET /api/flows/[id] loads the editor flow and nodes.
 * PUT updates allowlisted flow fields and optionally replaces the graph.
 * DELETE removes an owned flow and cascades nodes, runs, and events.
 *
 * Every handler uses the existing verified-session Auth lookup. Persistence
 * repositories enforce account scope, role, and ownership for mutations.
 */

async function requireVerifiedUser(): Promise<
  | { ok: true; userId: string }
  | { ok: false; status: number; body: { error: string } }
> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return { ok: false, status: 401, body: { error: 'Unauthorized' } };
  }
  return { ok: true, userId: user.id };
}

export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> }
) {
  const { id } = await context.params;
  const guard = await requireVerifiedUser();
  if (!guard.ok) return NextResponse.json(guard.body, { status: guard.status });
  const repository = createPostgresFlowEditorLoadRepository(async () => ({
    userId: guard.userId,
  }));
  try {
    const data = await repository.getForFlow(id);
    return NextResponse.json(data);
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

interface PutBody {
  name?: string;
  description?: string | null;
  trigger_type?: 'keyword' | 'first_inbound_message' | 'manual';
  trigger_config?: Record<string, unknown>;
  entry_node_id?: string | null;
  fallback_policy?: Record<string, unknown>;
  nodes?: FlowNodeReplacementInput[];
}

export async function PUT(
  request: Request,
  context: { params: Promise<{ id: string }> }
) {
  const { id } = await context.params;
  const guard = await requireVerifiedUser();
  if (!guard.ok) return NextResponse.json(guard.body, { status: guard.status });

  const body = (await request.json().catch(() => null)) as PutBody | null;
  if (!body) {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }
  if (body.name !== undefined && !body.name.trim()) {
    return NextResponse.json(
      { error: 'name cannot be empty' },
      { status: 400 }
    );
  }

  const getVerifiedSession = async () => ({ userId: guard.userId });
  try {
    const flowPatch: FlowHeaderPatch = {};
    if (body.name !== undefined) flowPatch.name = body.name.trim();
    if (body.description !== undefined)
      flowPatch.description = body.description;
    if (body.trigger_type !== undefined)
      flowPatch.trigger_type = body.trigger_type;
    if (body.trigger_config !== undefined)
      flowPatch.trigger_config = body.trigger_config;
    if (body.entry_node_id !== undefined)
      flowPatch.entry_node_id = body.entry_node_id;
    if (body.fallback_policy !== undefined)
      flowPatch.fallback_policy = body.fallback_policy;

    const headerRepository =
      createPostgresFlowHeaderUpdateRepository(getVerifiedSession);
    await headerRepository.updateForFlow(id, flowPatch);

    if (body.nodes !== undefined) {
      const graphRepository =
        createPostgresFlowNodeGraphReplaceRepository(getVerifiedSession);
      await graphRepository.replaceForFlow(
        id,
        body.nodes as FlowNodeReplacementInput[]
      );
    }

    const editorRepository =
      createPostgresFlowEditorLoadRepository(getVerifiedSession);
    const data = await editorRepository.getForFlow(id);
    return NextResponse.json(data);
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
export async function DELETE(
  _request: Request,
  context: { params: Promise<{ id: string }> }
) {
  const { id } = await context.params;
  const guard = await requireVerifiedUser();
  if (!guard.ok) return NextResponse.json(guard.body, { status: guard.status });

  const repository = createPostgresFlowDeletePersistenceRepository(
    async () => ({
      userId: guard.userId,
    })
  );
  try {
    await repository.deleteOwnedFlow(id);
    return NextResponse.json({ ok: true });
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
