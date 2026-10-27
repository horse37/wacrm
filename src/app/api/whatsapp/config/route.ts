import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import {
  registerPhoneNumber,
  subscribeWabaToApp,
  verifyPhoneNumber,
} from '@/lib/whatsapp/meta-api';
import { encrypt, decrypt } from '@/lib/whatsapp/encryption';
import { toAppError } from '@/lib/db/errors';
import {
  createPostgresWhatsAppConfigRepository,
  type WhatsAppConnectionConfigWrite,
} from '@/lib/repositories/whatsapp-config';

const duplicatePhoneNumberError =
  'This WhatsApp phone number is already linked to another account on this instance. Each phone number can only be connected to one wacrm user.';

type MetaOperationOutcome = 'completed' | 'failed' | 'skipped';

type PartialPersistenceDetails = {
  reservation_persisted: boolean;
  final_configuration_persisted: false;
  configuration_state:
    | 'disconnected_reservation'
    | 'same_number_path_no_prewrite';
  meta_registration: MetaOperationOutcome;
  meta_subscription: MetaOperationOutcome;
};

function postRepositoryErrorResponse(
  error: unknown,
  fallbackMessage: string,
  partialPersistence?: PartialPersistenceDetails
) {
  const appError = toAppError(error);
  const jsonError = (message: string, status: number) =>
    NextResponse.json(
      {
        error: message,
        ...(partialPersistence
          ? { partial_persistence: partialPersistence }
          : {}),
      },
      { status }
    );

  if (appError.code === 'unauthorized') {
    return jsonError('Unauthorized', 401);
  }
  if (appError.sqlState === '42501') {
    console.error(
      'PostgreSQL permission or row-level policy failure in WhatsApp config:',
      appError.message
    );
    return jsonError(fallbackMessage, 500);
  }
  if (appError.code === 'forbidden') {
    const message =
      appError.reason === 'insufficient_role'
        ? 'Your account role does not allow managing WhatsApp configuration.'
        : 'Your profile is not linked to an account.';
    return jsonError(message, 403);
  }
  if (appError.code === 'conflict') {
    return jsonError(duplicatePhoneNumberError, 409);
  }

  console.error('Error saving whatsapp_config:', appError.message);
  return jsonError(fallbackMessage, 500);
}

/**
 * GET /api/whatsapp/config
 *
 * Used by the "Test API Connection" button and by the page to check
 * whether the saved config is healthy. Returns 200 in all non-auth cases
 * so the UI can render an appropriate message rather than show a 500.
 *
 * Response shape:
 *   { connected: true,  phone_info: {...} }
 *   { connected: false, reason: 'no_config',        message: '...' }
 *   { connected: false, reason: 'token_corrupted',  message: '...', needs_reset: true }
 *   { connected: false, reason: 'meta_api_error',   message: '...' }
 */
export async function GET() {
  try {
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
    let config: Awaited<ReturnType<typeof repository.getConnectionConfig>>;
    try {
      config = await repository.getConnectionConfig();
    } catch (error) {
      const appError = toAppError(error);
      if (appError.code === 'forbidden') {
        return NextResponse.json(
          {
            connected: false,
            reason: 'no_account',
            message: 'Your profile is not linked to an account.',
          },
          { status: 200 }
        );
      }
      if (appError.code === 'db_error' || appError.code === 'conflict') {
        console.error('Error fetching whatsapp_config:', appError.message);
        return NextResponse.json(
          {
            connected: false,
            reason: 'db_error',
            message: 'Failed to fetch configuration',
          },
          { status: 200 }
        );
      }
      throw error;
    }

    if (!config) {
      return NextResponse.json(
        {
          connected: false,
          reason: 'no_config',
          message:
            'No WhatsApp configuration saved yet. Fill in the form and click Save Configuration.',
        },
        { status: 200 }
      );
    }

    // Try to decrypt the stored token with the current ENCRYPTION_KEY.
    // If this fails, the key changed (or was never consistent across envs).
    let accessToken: string;
    try {
      accessToken = decrypt(config.encryptedAccessToken);
    } catch (err) {
      console.error('[whatsapp/config GET] Token decryption failed:', err);
      return NextResponse.json(
        {
          connected: false,
          reason: 'token_corrupted',
          needs_reset: true,
          message:
            'The stored access token cannot be decrypted with the current ENCRYPTION_KEY. This usually means the key changed, or it differs between environments (local vs Hostinger vs Vercel). Click "Reset Configuration" below, then re-save.',
        },
        { status: 200 }
      );
    }

    // Validate credentials against Meta
    try {
      const phoneInfo = await verifyPhoneNumber({
        phoneNumberId: config.phoneNumberId,
        accessToken,
      });
      return NextResponse.json({ connected: true, phone_info: phoneInfo });
    } catch (err) {
      const message =
        err instanceof Error ? err.message : 'Unknown Meta API error';
      console.error(
        '[whatsapp/config GET] Meta API verification failed:',
        message
      );
      return NextResponse.json(
        {
          connected: false,
          reason: 'meta_api_error',
          message: `Meta API rejected the credentials: ${message}`,
        },
        { status: 200 }
      );
    }
  } catch (error) {
    console.error('Error in WhatsApp config GET:', error);
    return NextResponse.json(
      { connected: false, reason: 'unknown', message: 'Internal server error' },
      { status: 500 }
    );
  }
}

/**
 * POST /api/whatsapp/config
 *
 * Saves or updates the WhatsApp config for the authenticated user.
 * Verifies credentials with Meta first, then encrypts and stores.
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

    const repository = createPostgresWhatsAppConfigRepository(async () => ({
      userId: user.id,
    }));
    let existing: Awaited<ReturnType<typeof repository.getRegistrationState>>;
    try {
      existing = await repository.getRegistrationState();
    } catch (error) {
      return postRepositoryErrorResponse(
        error,
        'Failed to validate configuration'
      );
    }

    const body = await request.json();
    const { phone_number_id, waba_id, access_token, verify_token, pin } = body;

    if (!access_token || !phone_number_id) {
      return NextResponse.json(
        { error: 'access_token and phone_number_id are required' },
        { status: 400 }
      );
    }

    if (pin !== undefined && pin !== null && pin !== '') {
      if (typeof pin !== 'string' || !/^\d{6}$/.test(pin)) {
        return NextResponse.json(
          { error: 'PIN must be exactly 6 digits.' },
          { status: 400 }
        );
      }
    }

    // Verify credentials with Meta BEFORE saving
    let phoneInfo;
    try {
      phoneInfo = await verifyPhoneNumber({
        phoneNumberId: phone_number_id,
        accessToken: access_token,
      });
    } catch (err) {
      const message =
        err instanceof Error ? err.message : 'Unknown Meta API error';
      console.error('Meta API verification failed during save:', message);
      return NextResponse.json(
        { error: `Meta API error: ${message}` },
        { status: 400 }
      );
    }

    // Encrypt sensitive tokens before storing
    let encryptedAccessToken: string;
    let encryptedVerifyToken: string | null;
    try {
      encryptedAccessToken = encrypt(access_token);
      encryptedVerifyToken = verify_token ? encrypt(verify_token) : null;
    } catch (err) {
      const message =
        err instanceof Error ? err.message : 'Unknown encryption error';
      console.error('Encryption failed:', message);
      return NextResponse.json(
        {
          error:
            'Failed to encrypt token. Check that ENCRYPTION_KEY is a valid 64-character hex string in your environment variables.',
        },
        { status: 500 }
      );
    }

    const sameNumber =
      existing?.phoneNumberId === phone_number_id &&
      existing?.registeredAt != null;
    const samePhoneNumber = existing?.phoneNumberId === phone_number_id;

    // Step 1: register the phone number for inbound webhooks.
    //
    // Attempted on first save AND whenever the user supplies a fresh
    // PIN (e.g. they rotated the 2FA PIN in Meta Manager). Skipped
    // when the same number is already registered and no PIN was
    // supplied — re-registering an already-active number with a
    // stale PIN would actually fail and undo the active subscription.
    let registeredAt: Date | string | null = samePhoneNumber
      ? (existing?.registeredAt ?? null)
      : null;
    let registrationError: string | null = null;
    // True when registration was deliberately skipped because no PIN
    // was supplied (see below). Distinct from registrationError — this
    // is not a failure, just an incomplete-but-valid save.
    let registrationSkipped = false;

    const needsRegistration =
      !sameNumber || (typeof pin === 'string' && pin.length > 0);
    const mustReservePhoneNumber = existing?.phoneNumberId !== phone_number_id;
    const initialConfig: WhatsAppConnectionConfigWrite = {
      phoneNumberId: phone_number_id,
      wabaId: waba_id || null,
      encryptedAccessToken,
      encryptedVerifyToken,
      // A new reservation stays disconnected until all Meta work and the final
      // local state have been persisted successfully.
      status: 'disconnected',
      connectedAt: null,
      registeredAt: null,
      subscribedAppsAt: null,
      lastRegistrationError: null,
      updatedAt: new Date().toISOString(),
    };

    // An existing same-number row already holds the global unique constraint.
    // Skip its preliminary write so a later failure cannot leave it temporary.
    // New or changed numbers need a durable reservation before Meta mutations.
    if (mustReservePhoneNumber) {
      try {
        await repository.saveConnectionConfig(initialConfig);
      } catch (error) {
        return postRepositoryErrorResponse(
          error,
          existing
            ? 'Failed to update configuration'
            : 'Failed to save configuration'
        );
      }
    }

    // A concurrent DELETE/reassignment can release ownership after either
    // the same-number read or a new/changed-number reservation, before the
    // Meta mutation. The final save detects a lost reservation but cannot
    // undo completed Meta effects; a durable lock spanning DELETE and all
    // writers is outside this slice.
    let registrationOutcome: MetaOperationOutcome = 'skipped';
    if (needsRegistration) {
      if (!pin) {
        // No PIN provided. Meta TEST numbers (Developer Console) are
        // pre-registered by Meta and expose no two-step verification
        // PIN to set, so requiring one made them impossible to connect
        // (issue #242). The /register + PIN step only matters for
        // production numbers under a shared WABA (issue #136), so treat
        // it as best-effort: skip it, save the (already Meta-verified)
        // credentials as connected, and leave registered_at null. The
        // UI surfaces a separate "Not registered" banner with a path to
        // add a PIN later for users who do need inbound webhook routing.
        registrationSkipped = true;
      } else {
        try {
          await registerPhoneNumber({
            phoneNumberId: phone_number_id,
            accessToken: access_token,
            pin,
          });
          registeredAt = new Date().toISOString();
          registrationOutcome = 'completed';
        } catch (err) {
          registrationOutcome = 'failed';
          registrationError =
            err instanceof Error ? err.message : 'Unknown Meta API error';
          console.error('Phone number /register failed:', registrationError);
          // We deliberately fall through and still save the row so the
          // user can retry without re-entering everything. The UI
          // surfaces `last_registration_error` so they see WHY it's
          // not actually live yet.
        }
      }
    }

    // Step 2: subscribe the WABA to this app. Idempotent on Meta's
    // side, so we call on every save and persist the timestamp.
    // Skipped only when there's no waba_id (legacy rows from before
    // we required it).
    let subscribedAppsAt: string | null = null;
    let subscriptionOutcome: MetaOperationOutcome = 'skipped';
    if (waba_id) {
      try {
        await subscribeWabaToApp({
          wabaId: waba_id,
          accessToken: access_token,
        });
        subscribedAppsAt = new Date().toISOString();
        subscriptionOutcome = 'completed';
      } catch (err) {
        subscriptionOutcome = 'failed';
        const message = err instanceof Error ? err.message : String(err);
        console.warn('WABA subscribed_apps failed (non-fatal):', message);
        // Subscription failures are rare once the App has the right
        // permissions; we don't block save on them — the diagnostic
        // endpoint surfaces this state too.
      }
    }

    const finalConfig: WhatsAppConnectionConfigWrite = {
      ...initialConfig,
      status: registrationError ? 'disconnected' : 'connected',
      connectedAt: registrationError ? null : new Date().toISOString(),
      registeredAt: registrationError ? null : registeredAt,
      subscribedAppsAt,
      lastRegistrationError: registrationError,
      updatedAt: new Date().toISOString(),
    };

    try {
      await repository.saveConnectionConfig(finalConfig);
    } catch (error) {
      return postRepositoryErrorResponse(
        error,
        existing
          ? 'Failed to update configuration'
          : 'Failed to save configuration',
        {
          reservation_persisted: mustReservePhoneNumber,
          final_configuration_persisted: false,
          configuration_state: mustReservePhoneNumber
            ? 'disconnected_reservation'
            : 'same_number_path_no_prewrite',
          meta_registration: registrationOutcome,
          meta_subscription: subscriptionOutcome,
        }
      );
    }
    if (registrationError) {
      // Save succeeded but the number isn't actually live. Return
      // 200 with a structured error so the UI can show the specific
      // remediation step instead of a generic toast.
      return NextResponse.json({
        success: false,
        saved: true,
        registered: false,
        registration_error: registrationError,
        phone_info: phoneInfo,
      });
    }

    return NextResponse.json({
      success: true,
      saved: true,
      registered: registeredAt != null,
      // Credentials are valid and saved, but inbound webhook
      // registration was skipped because no PIN was supplied (e.g. a
      // Meta test number). The UI shows the "Not registered" banner
      // rather than claiming the number is fully live.
      registration_skipped: registrationSkipped,
      phone_info: phoneInfo,
    });
  } catch (error) {
    console.error('Error in WhatsApp config POST:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}

/**
 * DELETE /api/whatsapp/config
 *
 * Removes the authenticated user's WhatsApp configuration row.
 * Used by the "Reset Configuration" button to recover from a corrupted
 * encrypted token (mismatched ENCRYPTION_KEY across environments).
 */
export async function DELETE() {
  try {
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

    try {
      await repository.deleteConnectionConfig();
      return NextResponse.json({ success: true });
    } catch (error) {
      const appError = toAppError(error);
      if (appError.code === 'unauthorized') {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
      }
      if (appError.code === 'forbidden' || appError.sqlState === '42501') {
        return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
      }

      console.error('Error deleting whatsapp_config:', appError.message);
      return NextResponse.json(
        { error: 'Failed to delete configuration' },
        { status: 500 }
      );
    }
  } catch (error) {
    console.error('Error in WhatsApp config DELETE:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
