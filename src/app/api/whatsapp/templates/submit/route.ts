import { NextResponse } from 'next/server';
import { createDefaultPostgresAccountGuards } from '@/lib/auth/postgres-account-guard';
import { toAppError } from '@/lib/db/errors';
import { createPostgresTemplateLifecycleConfigRepository } from '@/lib/repositories/template-lifecycle-config';
import {
  createPostgresTemplateSubmitPersistenceRepository,
  type TemplateSubmitPersistedResult,
  type TemplateSubmitSnapshot,
} from '@/lib/repositories/template-submit-persistence';
import { createClient } from '@/lib/supabase/server';
import { decrypt } from '@/lib/whatsapp/encryption';
import { submitMessageTemplate } from '@/lib/whatsapp/meta-api';
import {
  validateTemplatePayload,
  type TemplatePayload,
} from '@/lib/whatsapp/template-validators';
import { buildMetaTemplatePayload } from '@/lib/whatsapp/template-components';
import { ensureImageHeaderHandle } from '@/lib/whatsapp/template-header-handle';
import { normalizeStatus } from '@/lib/whatsapp/template-status-normalize';

function buildSubmissionSnapshot(
  payload: TemplatePayload,
  status: TemplateSubmitSnapshot['status'],
  metaTemplateId: string | null,
  submissionError: string | null
): TemplateSubmitSnapshot {
  return {
    name: payload.name,
    category: payload.category,
    language: payload.language,
    headerType: payload.header_type ?? null,
    headerContent: payload.header_content ?? null,
    headerMediaUrl: payload.header_media_url ?? null,
    headerHandle: payload.header_handle ?? null,
    bodyText: payload.body_text,
    footerText: payload.footer_text ?? null,
    buttons: payload.buttons ?? null,
    sampleValues: payload.sample_values ?? null,
    status,
    metaTemplateId,
    submissionError,
    lastSubmittedAt: new Date().toISOString(),
  };
}

function buildTemplateResponse(
  persisted: TemplateSubmitPersistedResult,
  accountId: string,
  userId: string,
  snapshot: TemplateSubmitSnapshot
) {
  return {
    id: persisted.id,
    account_id: accountId,
    user_id: userId,
    name: snapshot.name,
    category: snapshot.category,
    language: snapshot.language,
    header_type: snapshot.headerType,
    header_content: snapshot.headerContent,
    header_media_url: snapshot.headerMediaUrl,
    header_handle: snapshot.headerHandle,
    body_text: snapshot.bodyText,
    footer_text: snapshot.footerText,
    buttons: snapshot.buttons,
    sample_values: snapshot.sampleValues,
    status: snapshot.status,
    meta_template_id: snapshot.metaTemplateId,
    submission_error: snapshot.submissionError,
    rejection_reason: null,
    last_submitted_at: snapshot.lastSubmittedAt,
    created_at: persisted.createdAt,
    updated_at: persisted.updatedAt,
    quality_score: persisted.qualityScore,
  };
}

function repositoryErrorResponse(error: unknown) {
  const appError = toAppError(error);
  const statusByCode: Record<string, number> = {
    unauthorized: 401,
    forbidden: 403,
    bad_request: 400,
    not_found: 404,
    conflict: 409,
    db_error: 500,
  };
  return NextResponse.json(
    { error: appError.message },
    { status: statusByCode[appError.code] ?? 500 }
  );
}
/**
 * Submit template for Meta approval and persist the outcome in PostgreSQL.
 * Existing session auth remains; database reads/writes use verified PostgreSQL repositories.
 */
export async function POST(request: Request) {
  try {
    const supabase = await createClient();
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();

    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    let payload: TemplatePayload;
    try {
      payload = (await request.json()) as TemplatePayload;
    } catch {
      return NextResponse.json(
        { error: 'Invalid JSON body.' },
        { status: 400 }
      );
    }

    if (payload.category === 'Authentication') {
      return NextResponse.json(
        {
          error:
            'AUTHENTICATION templates are not yet supported here — create them in Meta WhatsApp Manager and use "Sync from Meta".',
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

    const getVerifiedSession = async () => ({ userId: user.id });
    const accountGuards =
      createDefaultPostgresAccountGuards(getVerifiedSession);
    const account = await accountGuards.requireRole('admin');
    const persistence =
      createPostgresTemplateSubmitPersistenceRepository(getVerifiedSession);
    const dryRun =
      process.env.WHATSAPP_TEMPLATES_DRY_RUN === 'true' ||
      process.env.WHATSAPP_TEMPLATES_DRY_RUN === '1';

    let metaTemplateId: string;
    let metaStatus: string;

    if (dryRun) {
      metaTemplateId = 'dry-run-' + crypto.randomUUID();
      metaStatus = 'PENDING';
    } else {
      const configRepository =
        createPostgresTemplateLifecycleConfigRepository(getVerifiedSession);
      const config = await configRepository.getForDelete();
      if (!config) {
        return NextResponse.json(
          {
            error:
              'WhatsApp not configured. Connect your WhatsApp Business account in Settings first.',
          },
          { status: 400 }
        );
      }
      if (!config.wabaId) {
        return NextResponse.json(
          {
            error:
              'WABA (WhatsApp Business Account) ID missing. Re-connect your account in Settings.',
          },
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
        const meta = await submitMessageTemplate({
          wabaId: config.wabaId,
          accessToken,
          payload: metaPayload,
        });
        metaTemplateId = meta.id;
        metaStatus = meta.status;
      } catch (error) {
        const message =
          error instanceof Error ? error.message : 'Meta submit failed.';
        const snapshot = buildSubmissionSnapshot(
          payload,
          'DRAFT',
          null,
          message
        );
        await persistence.upsertOne(snapshot);

        const isRateLimit = /\b429\b/.test(message);
        return NextResponse.json(
          {
            error: isRateLimit
              ? 'Meta rate limit hit (100 template creates per hour). Try again later.'
              : message,
          },
          { status: isRateLimit ? 429 : 502 }
        );
      }
    }

    const status = normalizeStatus(metaStatus);
    const snapshot = buildSubmissionSnapshot(
      payload,
      status,
      metaTemplateId,
      null
    );

    let persisted: TemplateSubmitPersistedResult;
    try {
      persisted = await persistence.upsertOne(snapshot);
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Database error.';
      return NextResponse.json(
        {
          error:
            'Submitted to Meta but failed to save locally: ' +
            message +
            '. Run "Sync from Meta" to recover.',
          meta_template_id: metaTemplateId,
        },
        { status: 500 }
      );
    }

    return NextResponse.json({
      success: true,
      template: buildTemplateResponse(
        persisted,
        account.accountId,
        user.id,
        snapshot
      ),
      dry_run: dryRun,
    });
  } catch (error) {
    console.error('Error submitting template:', error);
    return repositoryErrorResponse(error);
  }
}
