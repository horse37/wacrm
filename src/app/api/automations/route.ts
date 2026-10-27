import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

import { toAppError } from '@/lib/db/errors';
import { createPostgresAutomationCreatePersistenceRepository } from '@/lib/repositories/automation-create-persistence';
import { createPostgresAutomationListRepository } from '@/lib/repositories/automation-list';
import { getTemplate } from '@/lib/automations/templates';
import {
  validateStepsForActivation,
  validateTriggerForActivation,
} from '@/lib/automations/validate';

export async function GET() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user)
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const repository = createPostgresAutomationListRepository(async () => ({
    userId: user.id,
  }));
  try {
    const automations = await repository.listForCurrentAccount();
    return NextResponse.json({ automations });
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
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user)
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const body = await request.json().catch(() => null);
  if (!body)
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });

  const {
    name,
    description,
    trigger_type,
    trigger_config,
    is_active,
    steps,
    template,
  } = body;

  let effectiveSteps = steps;
  let effectiveName = name;
  let effectiveDescription = description;
  let effectiveTriggerType = trigger_type;
  let effectiveTriggerConfig = trigger_config;

  if (template && (!steps || steps.length === 0)) {
    const selectedTemplate = getTemplate(template);
    if (selectedTemplate) {
      effectiveName = effectiveName ?? selectedTemplate.name;
      effectiveDescription =
        effectiveDescription ?? selectedTemplate.description;
      effectiveTriggerType =
        effectiveTriggerType ?? selectedTemplate.trigger_type;
      effectiveTriggerConfig =
        effectiveTriggerConfig ?? selectedTemplate.trigger_config;
      effectiveSteps = selectedTemplate.steps;
    }
  }

  if (!effectiveName || !effectiveTriggerType) {
    return NextResponse.json(
      { error: 'name and trigger_type are required' },
      { status: 400 }
    );
  }

  if (is_active) {
    const issues = [
      ...validateTriggerForActivation(
        effectiveTriggerType,
        effectiveTriggerConfig ?? {}
      ),
      ...validateStepsForActivation(effectiveSteps ?? []),
    ];
    if (issues.length > 0) {
      return NextResponse.json(
        {
          error: 'Cannot activate automation with invalid configuration',
          issues,
        },
        { status: 400 }
      );
    }
  }

  const repository = createPostgresAutomationCreatePersistenceRepository(
    async () => ({ userId: user.id })
  );
  try {
    const automation = await repository.createAutomation({
      name: effectiveName,
      description: effectiveDescription ?? null,
      trigger_type: effectiveTriggerType,
      trigger_config: effectiveTriggerConfig ?? {},
      is_active: Boolean(is_active),
      steps: effectiveSteps ?? [],
    });
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
