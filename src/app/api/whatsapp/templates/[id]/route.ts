import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createDefaultPostgresAccountGuards } from '@/lib/auth/postgres-account-guard';
import { toAppError } from '@/lib/db/errors';
import { createPostgresTemplateLifecycleConfigRepository } from '@/lib/repositories/template-lifecycle-config';
import { createPostgresTemplateLifecycleContextRepository } from '@/lib/repositories/template-lifecycle-context';
import { createPostgresTemplateDeletePersistenceRepository } from '@/lib/repositories/template-delete-persistence';
import { createPostgresTemplateEditPersistenceRepository } from '@/lib/repositories/template-edit-persistence';
import { decrypt } from '@/lib/whatsapp/encryption'
import {
  deleteMessageTemplate,
  editMessageTemplate,
} from '@/lib/whatsapp/meta-api'
import {
  validateTemplatePayload,
  type TemplatePayload,
} from '@/lib/whatsapp/template-validators'
import { buildMetaTemplatePayload } from '@/lib/whatsapp/template-components'
import { ensureImageHeaderHandle } from '@/lib/whatsapp/template-header-handle'

/**
 * Per-template lifecycle endpoint.
 *
 * PATCH  — edit an existing Meta-side template (and re-submit). Used
 *          by the "Edit" action on APPROVED rows and the "Resubmit"
 *          action on REJECTED / PAUSED rows. Meta replaces components
 *          wholesale on edit and bumps status back to PENDING.
 *
 * DELETE — remove the template on Meta (when meta_template_id is set,
 *          scoped to a single language variant via hsm_id) AND drop
 *          the local row. Local-only rows skip the Meta call.
 *
 * Initial submission (DRAFT → PENDING) lives at the sibling
 * /submit endpoint — keep this route narrowly about lifecycle of
 * already-submitted templates.
 */

const EDITABLE_STATUSES = new Set(['APPROVED', 'REJECTED', 'PAUSED'])

// uuid v4 plus the looser shape Postgres gen_random_uuid emits.
// We don't need exhaustive RFC parsing — just enough to reject
// "../etc/passwd"-style payloads before they hit Supabase.
const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

function isDryRun(): boolean {
  return (
    process.env.WHATSAPP_TEMPLATES_DRY_RUN === 'true' ||
    process.env.WHATSAPP_TEMPLATES_DRY_RUN === '1'
  )
}

function repositoryErrorResponse(error: unknown) {
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

export async function PATCH(
  request: Request,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await context.params;
    if (!UUID_RE.test(id)) {
      return NextResponse.json(
        { error: 'Invalid template id.' },
        { status: 400 }
      );
    }

    const supabase = await createClient();
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();
    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const getVerifiedSession = async () => ({ userId: user.id });
    const accountGuards =
      createDefaultPostgresAccountGuards(getVerifiedSession);
    await accountGuards.requireRole('admin');

    let payload: TemplatePayload;
    try {
      payload = (await request.json()) as TemplatePayload;
    } catch {
      return NextResponse.json(
        { error: 'Invalid JSON body.' },
        { status: 400 }
      );
    }

    const contextRepository =
      createPostgresTemplateLifecycleContextRepository(getVerifiedSession);
    const existing = await contextRepository.getForEdit(id);
    if (!existing) {
      return NextResponse.json(
        { error: 'Template not found.' },
        { status: 404 }
      );
    }
    if (!existing.metaTemplateId) {
      return NextResponse.json(
        {
          error:
            'Template has never been submitted to Meta — use New Template submit instead.',
        },
        { status: 400 }
      );
    }
    if (!EDITABLE_STATUSES.has(existing.status)) {
      return NextResponse.json(
        {
          error:
            'Templates in status ' +
            existing.status +
            ' cannot be edited. Allowed: APPROVED, REJECTED, PAUSED.',
        },
        { status: 400 }
      );
    }
    if (payload.category === 'Authentication') {
      return NextResponse.json(
        {
          error:
            'AUTHENTICATION templates are not editable here — manage them in Meta WhatsApp Manager.',
        },
        { status: 400 }
      );
    }
    try {
      validateTemplatePayload(payload);
    } catch (error) {
      return NextResponse.json(
        {
          error: error instanceof Error ? error.message : 'Validation failed.',
        },
        { status: 400 }
      );
    }

    const lastSubmittedAt = new Date().toISOString();
    if (!isDryRun()) {
      const configRepository =
        createPostgresTemplateLifecycleConfigRepository(getVerifiedSession);
      const config = await configRepository.getForEdit();
      if (!config) {
        return NextResponse.json(
          { error: 'WhatsApp not configured.' },
          { status: 400 }
        );
      }

      const accessToken = decrypt(config.encryptedAccessToken);
      try {
        await ensureImageHeaderHandle(payload, accessToken);
      } catch (error) {
        return NextResponse.json(
          {
            error:
              error instanceof Error
                ? error.message
                : 'Header image upload failed.',
          },
          { status: 400 }
        );
      }

      const metaPayload = buildMetaTemplatePayload(payload);
      try {
        await editMessageTemplate({
          metaTemplateId: existing.metaTemplateId,
          accessToken,
          components: metaPayload.components,
        });
      } catch (error) {
        const message =
          error instanceof Error ? error.message : 'Meta edit failed.';
        const editRepository =
          createPostgresTemplateEditPersistenceRepository(getVerifiedSession);
        await editRepository.persist({
          templateId: id,
          lastSubmittedAt,
          outcome: { kind: 'provider_failure', error: message },
        });
        return NextResponse.json({ error: message }, { status: 502 });
      }
    }

    const editRepository =
      createPostgresTemplateEditPersistenceRepository(getVerifiedSession);
    let persisted: Awaited<ReturnType<typeof editRepository.persist>>;
    try {
      persisted = await editRepository.persist({
        templateId: id,
        lastSubmittedAt,
        outcome: { kind: 'provider_success', payload },
      });
    } catch (error) {
      const appError = toAppError(error);
      console.error(
        'Template edit succeeded on Meta but local persistence failed:',
        appError.code
      );
      return NextResponse.json(
        {
          error:
            'Edited on Meta but failed to save locally. Run "Sync from Meta" to recover.',
        },
        { status: 500 }
      );
    }
    if (persisted.template === null) {
      throw new Error('Template edit persistence returned no updated row.');
    }

    return NextResponse.json({
      success: true,
      template: persisted.template,
      dry_run: isDryRun(),
    });
  } catch (error) {
    console.error('Error editing template:', error);
    return repositoryErrorResponse(error);
  }
}
export async function DELETE(
  _request: Request,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await context.params;
    if (!UUID_RE.test(id)) {
      return NextResponse.json(
        { error: 'Invalid template id.' },
        { status: 400 }
      );
    }
    const supabase = await createClient();
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();
    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const getVerifiedSession = async () => ({ userId: user.id });
    const contextRepository =
      createPostgresTemplateLifecycleContextRepository(getVerifiedSession);
    const existing = await contextRepository.getForDelete(id);
    if (!existing) {
      return NextResponse.json(
        { error: 'Template not found.' },
        { status: 404 }
      );
    }

    // The local delete repository enforces admin access. Check it before
    // deleting anything remotely, then enforce it again in the write transaction.
    const accountGuards =
      createDefaultPostgresAccountGuards(getVerifiedSession);
    await accountGuards.requireRole('admin');

    if (existing.metaTemplateId && !isDryRun()) {
      const configRepository =
        createPostgresTemplateLifecycleConfigRepository(getVerifiedSession);
      const config = await configRepository.getForDelete();
      if (!config || !config.wabaId) {
        return NextResponse.json(
          { error: 'WhatsApp not configured — cannot delete on Meta.' },
          { status: 400 }
        );
      }
      const accessToken = decrypt(config.encryptedAccessToken);
      try {
        await deleteMessageTemplate({
          wabaId: config.wabaId,
          accessToken,
          name: existing.name,
          metaTemplateId: existing.metaTemplateId,
        });
      } catch (e) {
        const message = e instanceof Error ? e.message : 'Meta delete failed.';
        return NextResponse.json({ error: message }, { status: 502 });
      }
    }

    const deleteRepository =
      createPostgresTemplateDeletePersistenceRepository(getVerifiedSession);
    await deleteRepository.deleteTemplate(id);

    return NextResponse.json({ success: true, dry_run: isDryRun() });
  } catch (error) {
    console.error('Error deleting template:', error);
    return repositoryErrorResponse(error);
  }
}
