import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { toAppError } from '@/lib/db/errors';
import { createPostgresWhatsAppConfigRepository } from '@/lib/repositories/whatsapp-config';
import { decrypt } from '@/lib/whatsapp/encryption';
import { getSubscribedApps, verifyPhoneNumber } from '@/lib/whatsapp/meta-api';

/**
 * GET /api/whatsapp/config/verify-registration
 *
 * Diagnostic endpoint — confirms the user's saved phone number is
 * actually reachable on Meta's side. Solves the failure mode that
 * surfaced the multi-number bug originally: "UI says Connected but
 * Meta isn't delivering events."
 *
 * Three checks run independently so the UI can show which step
 * passes and which fails:
 *
 *   1. phone_info  — GET /{phone_number_id} succeeds
 *   2. waba_subscription — our app appears in
 *                    GET /{waba_id}/subscribed_apps
 *   3. registered_at — local timestamp set by POST /config when
 *                    /register last succeeded; NULL means the
 *                    number was saved but never actually subscribed
 *
 * Returns 200 in every case so the UI can render diagnostic detail
 * rather than a generic error toast. The combined `live` flag is
 * what the UI badges on.
 */
export async function GET() {
  const supabase = await createClient();
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();
  if (authError || !user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const repository = createPostgresWhatsAppConfigRepository(async () => ({
    userId: user.id,
  }));
  let config;
  try {
    config = await repository.getRegistrationDiagnostics();
  } catch (error) {
    const appError = toAppError(error);
    if (appError.code === 'forbidden') {
      return NextResponse.json({
        live: false,
        checks: { config_exists: false },
        message: 'Your profile is not linked to an account.',
      });
    }
    console.error('Failed to load WhatsApp registration diagnostics:', {
      code: appError.code,
      sqlState: appError.sqlState,
    });
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }

  if (!config) {
    return NextResponse.json({
      live: false,
      checks: { config_exists: false },
      message: 'No WhatsApp configuration saved yet.',
    });
  }

  let accessToken: string;
  try {
    accessToken = decrypt(config.encryptedAccessToken);
  } catch {
    return NextResponse.json({
      live: false,
      checks: {
        config_exists: true,
        token_decryptable: false,
      },
      message:
        "Stored access token can't be decrypted — likely ENCRYPTION_KEY changed. Re-enter the token to repair.",
    });
  }

  const checks: {
    config_exists: boolean;
    token_decryptable: boolean;
    phone_metadata_ok: boolean;
    waba_subscribed_to_app: boolean | null;
    locally_marked_registered: boolean;
  } = {
    config_exists: true,
    token_decryptable: true,
    phone_metadata_ok: false,
    waba_subscribed_to_app: null,
    locally_marked_registered: config.registeredAt != null,
  };
  const errors: string[] = [];

  try {
    await verifyPhoneNumber({
      phoneNumberId: config.phoneNumberId,
      accessToken,
    });
    checks.phone_metadata_ok = true;
  } catch (err) {
    errors.push(
      `Phone metadata check failed: ${err instanceof Error ? err.message : String(err)}`
    );
  }

  if (config.wabaId) {
    try {
      const subs = await getSubscribedApps({
        wabaId: config.wabaId,
        accessToken,
      });
      checks.waba_subscribed_to_app = subs.length > 0;
      if (!checks.waba_subscribed_to_app) {
        errors.push(
          'WABA has no subscribed apps. Re-save the configuration to subscribe.'
        );
      }
    } catch (err) {
      errors.push(
        `WABA subscription check failed: ${err instanceof Error ? err.message : String(err)}`
      );
    }
  } else {
    errors.push(
      "No WABA ID on file — webhooks can't be wired without it. Add it in the form and re-save."
    );
  }

  const live =
    checks.phone_metadata_ok &&
    (checks.waba_subscribed_to_app ?? false) &&
    checks.locally_marked_registered;

  return NextResponse.json({
    live,
    checks,
    errors,
    last_registration_error: config.lastRegistrationError,
    registered_at: config.registeredAt,
    subscribed_apps_at: config.subscribedAppsAt,
  });
}
