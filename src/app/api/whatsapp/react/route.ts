import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { toAppError } from '@/lib/db/errors';
import { createPostgresMessageReactionPersistenceRepository } from '@/lib/repositories/message-reaction-persistence';
import { createPostgresMessageReactionTargetRepository } from '@/lib/repositories/message-reaction-target';
import { createPostgresWhatsAppConfigRepository } from '@/lib/repositories/whatsapp-config';
import { sendReactionMessage } from '@/lib/whatsapp/meta-api';
import { decrypt } from '@/lib/whatsapp/encryption';
import { sanitizePhoneForMeta } from '@/lib/whatsapp/phone-utils';
import {
  checkRateLimit,
  rateLimitResponse,
  RATE_LIMITS,
} from '@/lib/rate-limit';

/**
 * POST /api/whatsapp/react
 *
 * Body: { message_id: <internal UUID>, emoji: <single emoji or "" remove> }
 *
 * Sends reaction Meta and mirrors it into `message_reactions`
 * (delete on empty emoji). Customer-side reactions handled by
 * webhook — this route only writes `actor_type = 'agent'` rows.
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

    const limit = checkRateLimit(`react:${user.id}`, RATE_LIMITS.react);
    if (!limit.success) return rateLimitResponse(limit);

    const body = await request.json();
    const { message_id, emoji } = body as {
      message_id?: string;
      emoji?: string;
    };

    if (!message_id || typeof emoji !== 'string') {
      return NextResponse.json(
        { error: 'message_id and emoji are required' },
        { status: 400 }
      );
    }

    // Keep current server-side authentication; repositories resolve membership
    // and all application data through PostgreSQL.
    const getVerifiedSession = async () => ({ userId: user.id });
    const targetRepository =
      createPostgresMessageReactionTargetRepository(getVerifiedSession);
    const configRepository =
      createPostgresWhatsAppConfigRepository(getVerifiedSession);
    const persistenceRepository =
      createPostgresMessageReactionPersistenceRepository(getVerifiedSession);

    let target;
    try {
      target = await targetRepository.getTarget(message_id);
    } catch (error) {
      const appError = toAppError(error);
      if (appError.code === 'not_found') {
        return NextResponse.json(
          { error: 'Message not found' },
          { status: 404 }
        );
      }
      if (appError.code === 'bad_request') {
        return NextResponse.json(
          { error: 'Message not found' },
          { status: 404 }
        );
      }
      if (appError.code === 'forbidden') {
        return NextResponse.json(
          { error: 'Your profile is not linked to an account.' },
          { status: 403 }
        );
      }
      if (appError.code === 'unauthorized') {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
      }
      throw error;
    }

    if (!target.providerMessageId) {
      return NextResponse.json(
        {
          error: 'Cannot react to a message that has not been sent to WhatsApp',
        },
        { status: 400 }
      );
    }

    if (!target.contactPhone) {
      return NextResponse.json(
        { error: 'Contact phone number not found' },
        { status: 400 }
      );
    }

    let config;
    try {
      config = await configRepository.getConnectionConfig();
    } catch (error) {
      const appError = toAppError(error);
      if (appError.code === 'forbidden') {
        return NextResponse.json(
          { error: 'Your profile is not linked to an account.' },
          { status: 403 }
        );
      }
      if (appError.code === 'unauthorized') {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
      }
      throw error;
    }

    if (!config) {
      return NextResponse.json(
        { error: 'WhatsApp not configured.' },
        { status: 400 }
      );
    }

    const accessToken = decrypt(config.encryptedAccessToken);
    const sanitizedPhone = sanitizePhoneForMeta(target.contactPhone);

    try {
      await sendReactionMessage({
        phoneNumberId: config.phoneNumberId,
        accessToken,
        to: sanitizedPhone,
        targetMessageId: target.providerMessageId,
        emoji,
      });
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Unknown Meta API error';
      console.error('[whatsapp/react] Meta send failed:', message);
      return NextResponse.json(
        { error: `Meta API error: ${message}` },
        { status: 502 }
      );
    }

    try {
      await persistenceRepository.saveAgentReaction(message_id, emoji);
    } catch (error) {
      const message = toAppError(error).message;
      const operation = emoji === '' ? 'delete' : 'upsert';
      console.error(`[whatsapp/react] DB ${operation} failed:`, message);
      return NextResponse.json(
        {
          error:
            emoji === ''
              ? 'Reaction sent to Meta but DB delete failed'
              : 'Reaction sent to Meta but DB upsert failed',
        },
        { status: 500 }
      );
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Error in WhatsApp react POST:', error);
    return NextResponse.json(
      { error: 'Failed to react to message' },
      { status: 500 }
    );
  }
}
