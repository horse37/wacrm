import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createDefaultPostgresAccountGuards } from '@/lib/auth/postgres-account-guard';
import { toAppError } from '@/lib/db/errors';
import { createPostgresTemplateLifecycleConfigRepository } from '@/lib/repositories/template-lifecycle-config';
import { createPostgresTemplateSyncPersistenceRepository } from '@/lib/repositories/template-sync-persistence';
import { decrypt } from '@/lib/whatsapp/encryption';
import { normalizeStatus } from '@/lib/whatsapp/template-status-normalize';
import type { TemplateButton, TemplateSampleValues } from '@/types';

/**
 * Sync message templates from Meta → local message_templates table.
 *
 * The local catalog stores Meta's status enum verbatim (APPROVED /
 * PENDING / REJECTED / PAUSED / DISABLED / IN_APPEAL / PENDING_DELETION)
 * so the edit / resubmit / delete flows can distinguish recoverable
 * states (PAUSED) from terminal ones (DISABLED) and so webhook events
 * land 1:1 without a translation table.
 *
 * Locally-created templates (no Meta counterpart) are NOT deleted —
 * they remain visible so the user can notice drift and clean up.
 */

const META_API_VERSION = 'v21.0';
const META_API_BASE = `https://graph.facebook.com/${META_API_VERSION}`;
const META_API_ORIGIN = new URL(META_API_BASE).origin;

interface MetaButton {
  type: string;
  text: string;
  url?: string;
  phone_number?: string;
  example?: string[] | string;
}

interface MetaTemplateComponent {
  type: string;
  text?: string;
  format?: string;
  buttons?: MetaButton[];
  example?: {
    header_text?: string[];
    header_handle?: string[];
    body_text?: string[][];
  };
}

interface MetaTemplate {
  id: string;
  name: string;
  language: string;
  status: string;
  category: string;
  components?: MetaTemplateComponent[];
  quality_score?: { score?: string } | string;
}

function normalizeCategory(
  meta: string
): 'Marketing' | 'Utility' | 'Authentication' {
  const upper = meta.toUpperCase();
  if (upper === 'UTILITY') return 'Utility';
  if (upper === 'AUTHENTICATION') return 'Authentication';
  return 'Marketing';
}

function normalizeQualityScore(
  raw: MetaTemplate['quality_score']
): 'GREEN' | 'YELLOW' | 'RED' | null {
  const score =
    typeof raw === 'string' ? raw : raw?.score ? String(raw.score) : null;
  if (!score) return null;
  const upper = score.toUpperCase();
  return upper === 'GREEN' || upper === 'YELLOW' || upper === 'RED'
    ? (upper as 'GREEN' | 'YELLOW' | 'RED')
    : null;
}

function parseButtons(metaButtons: MetaButton[] | undefined): TemplateButton[] {
  if (!metaButtons?.length) return [];
  const out: TemplateButton[] = [];
  for (const b of metaButtons) {
    switch (b.type?.toUpperCase()) {
      case 'QUICK_REPLY':
        out.push({ type: 'QUICK_REPLY', text: b.text });
        break;
      case 'URL':
        out.push({
          type: 'URL',
          text: b.text,
          url: b.url ?? '',
          example: Array.isArray(b.example) ? b.example[0] : b.example,
        });
        break;
      case 'PHONE_NUMBER':
        out.push({
          type: 'PHONE_NUMBER',
          text: b.text,
          phone_number: b.phone_number ?? '',
        });
        break;
      case 'COPY_CODE':
        out.push({
          type: 'COPY_CODE',
          text: b.text,
          example: Array.isArray(b.example)
            ? (b.example[0] ?? '')
            : (b.example ?? ''),
        });
        break;
      // OTP, FLOW, etc — out of scope for v1; drop silently.
    }
  }
  return out;
}

function extractSampleValues(
  body: MetaTemplateComponent | undefined,
  header: MetaTemplateComponent | undefined
): TemplateSampleValues | null {
  // Meta returns body_text as a 2D array — one row per example set.
  // We take the first row (most templates have exactly one).
  const bodySample = body?.example?.body_text?.[0];
  const headerSample = header?.example?.header_text;
  if (!bodySample?.length && !headerSample?.length) return null;
  const sv: TemplateSampleValues = {};
  if (bodySample?.length) sv.body = bodySample;
  if (headerSample?.length) sv.header = headerSample;
  return sv;
}

function isAllowedMetaPageUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return (
      url.protocol === 'https:' &&
      url.origin === META_API_ORIGIN &&
      url.username === '' &&
      url.password === '' &&
      url.pathname.startsWith(`/${META_API_VERSION}/`)
    );
  } catch {
    return false;
  }
}

export async function POST() {
  const repositoryErrorResponse = (error: unknown) => {
    const appError = toAppError(error);
    const statusByCode: Record<string, number> = {
      unauthorized: 401,
      forbidden: 403,
      bad_request: 400,
      not_found: 404,
      conflict: 409,
      db_error: 500,
    };
    const message =
      appError.reason === 'insufficient_role'
        ? 'An administrator is required to sync templates.'
        : appError.code === 'forbidden'
          ? 'Your profile is not linked to an account.'
          : appError.message;

    return NextResponse.json(
      { error: message },
      { status: statusByCode[appError.code] ?? 500 }
    );
  };

  try {
    const supabase = await createClient();
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();

    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const getVerifiedSession = async () => ({ userId: user.id });
    const guards = createDefaultPostgresAccountGuards(getVerifiedSession);

    try {
      await guards.requireRole('admin');
    } catch (error) {
      return repositoryErrorResponse(error);
    }

    const configRepository =
      createPostgresTemplateLifecycleConfigRepository(getVerifiedSession);
    let config;
    try {
      config = await configRepository.getForDelete();
    } catch (error) {
      return repositoryErrorResponse(error);
    }

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
    const syncRepository =
      createPostgresTemplateSyncPersistenceRepository(getVerifiedSession);
    const metaTemplates: MetaTemplate[] = [];
    let nextUrl: string | null =
      `${META_API_BASE}/${config.wabaId}/message_templates?limit=100&fields=id,name,language,status,category,components,quality_score`;
    const PAGE_CAP = 20;
    let pageCount = 0;

    while (nextUrl && pageCount < PAGE_CAP) {
      if (!isAllowedMetaPageUrl(nextUrl)) {
        return NextResponse.json(
          { error: 'Meta returned an invalid pagination URL.' },
          { status: 502 }
        );
      }
      pageCount++;
      const metaRes: Response = await fetch(nextUrl, {
        headers: { Authorization: `Bearer ${accessToken}` },
      });

      if (!metaRes.ok) {
        let metaError = `Meta API error: ${metaRes.status}`;
        try {
          const body = await metaRes.json();
          if (body?.error?.message) metaError = body.error.message;
        } catch {
          // Response was not JSON; keep the HTTP fallback.
        }
        return NextResponse.json({ error: metaError }, { status: 502 });
      }

      const metaBody: {
        data?: MetaTemplate[];
        paging?: { next?: string };
      } = await metaRes.json();
      if (metaBody.data) metaTemplates.push(...metaBody.data);
      nextUrl = metaBody.paging?.next ?? null;
    }

    let inserted = 0;
    let updated = 0;
    const errors: { name: string; language: string; message: string }[] = [];

    for (const template of metaTemplates) {
      try {
        const components = template.components ?? [];
        const body = components.find((component) => component.type === 'BODY');
        const header = components.find(
          (component) => component.type === 'HEADER'
        );
        const footer = components.find(
          (component) => component.type === 'FOOTER'
        );
        const buttons = components.find(
          (component) => component.type === 'BUTTONS'
        );
        const parsedButtons = parseButtons(buttons?.buttons);
        const headerFormat = header?.format?.toUpperCase();
        const headerType =
          headerFormat === 'TEXT' ||
          headerFormat === 'IMAGE' ||
          headerFormat === 'VIDEO' ||
          headerFormat === 'DOCUMENT'
            ? (headerFormat.toLowerCase() as
                | 'text'
                | 'image'
                | 'video'
                | 'document')
            : null;

        const result = await syncRepository.upsertOne({
          name: template.name,
          category: normalizeCategory(template.category),
          language: template.language,
          headerType,
          headerContent: header?.text ?? null,
          headerHandle: header?.example?.header_handle?.[0] ?? null,
          bodyText: body?.text ?? '',
          footerText: footer?.text ?? null,
          buttons: parsedButtons.length ? parsedButtons : null,
          sampleValues: extractSampleValues(body, header),
          status: normalizeStatus(template.status),
          metaTemplateId: template.id,
          qualityScore: normalizeQualityScore(template.quality_score),
          updatedAt: new Date().toISOString(),
        });

        if (result.action === 'inserted') inserted++;
        else updated++;
      } catch (error) {
        errors.push({
          name: template.name,
          language: template.language,
          message: toAppError(error).message,
        });
      }
    }

    return NextResponse.json({
      success: errors.length === 0,
      total: metaTemplates.length,
      inserted,
      updated,
      errors,
      truncated: pageCount >= PAGE_CAP && nextUrl !== null,
    });
  } catch (error) {
    console.error('Error syncing WhatsApp templates:', error);
    return NextResponse.json(
      {
        error:
          error instanceof Error ? error.message : 'Failed to sync templates',
      },
      { status: 500 }
    );
  }
}
