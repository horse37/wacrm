import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { toAppError } from '@/lib/db/errors';
import { createPostgresAutomationEditorRepository } from '@/lib/repositories/automation-editor';
import {
  AutomationActivationValidationError,
  createPostgresAutomationUpdatePersistenceRepository,
} from '@/lib/repositories/automation-update-persistence';
import { createPostgresAutomationDeletePersistenceRepository } from '@/lib/repositories/automation-delete-persistence';

async function requireUser() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return user;
}

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const user = await requireUser();
  if (!user)
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const repository = createPostgresAutomationEditorRepository(async () => ({
    userId: user.id,
  }));
  try {
    const editorData = await repository.getForAutomation(id);
    return NextResponse.json(editorData);
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
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const user = await requireUser();
  if (!user)
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const repository = createPostgresAutomationUpdatePersistenceRepository(
    async () => ({ userId: user.id })
  );
  try {
    await repository.patchOwnedAutomation(id, body);
    return NextResponse.json({ ok: true });
  } catch (error) {
    if (error instanceof AutomationActivationValidationError) {
      return NextResponse.json(
        {
          error: 'Cannot keep automation active with invalid configuration',
          issues: error.issues,
        },
        { status: 400 }
      );
    }

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
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const user = await requireUser();
  if (!user)
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const repository = createPostgresAutomationDeletePersistenceRepository(
    async () => ({ userId: user.id })
  );
  try {
    await repository.deleteOwnedAutomation(id);
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
