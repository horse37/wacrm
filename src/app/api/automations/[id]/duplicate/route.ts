import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

import { toAppError } from '@/lib/db/errors';
import { createPostgresAutomationDuplicatePersistenceRepository } from '@/lib/repositories/automation-duplicate-persistence';

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user)
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const repository = createPostgresAutomationDuplicatePersistenceRepository(
    async () => ({ userId: user.id })
  );
  try {
    const automation = await repository.duplicateOwnedAutomation(id);
    return NextResponse.json({ automation }, { status: 201 });
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
