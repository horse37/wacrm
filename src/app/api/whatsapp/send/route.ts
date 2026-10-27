import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createDefaultPostgresAccountGuards } from '@/lib/auth/postgres-account-guard';
import { createPostgresWhatsAppSendConversationRepository } from '@/lib/repositories/whatsapp-send-conversation';
import { createPostgresWhatsAppSendFlowRunRepository } from '@/lib/repositories/whatsapp-send-flow-run';
import { createPostgresWhatsAppSendMessageRepository } from '@/lib/repositories/whatsapp-send-message';
import { createPostgresTemplateSendDefinitionRepository } from '@/lib/repositories/template-send-definition';
import { createPostgresWhatsAppConfigRepository } from '@/lib/repositories/whatsapp-config';
import type { TemplateSendDefinition } from '@/lib/repositories/template-send-definition';
import { toAppError } from '@/lib/db/errors';
import {
  sendTextMessage,
  sendTemplateMessage,
  sendMediaMessage,
  type MediaKind,
} from '@/lib/whatsapp/meta-api';
import { decrypt, encrypt, isLegacyFormat } from '@/lib/whatsapp/encryption';
import {
  sanitizePhoneForMeta,
  isValidE164,
  phoneVariants,
  isRecipientNotAllowedError,
} from '@/lib/whatsapp/phone-utils';
import {
  checkRateLimit,
  rateLimitResponse,
  RATE_LIMITS,
} from '@/lib/rate-limit';

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

    // Per-user rate limit. Bucket key is scoped to this route so
    // `/broadcast` has an independent budget.
    const limit = checkRateLimit(`send:${user.id}`, RATE_LIMITS.send);
    if (!limit.success) {
      return rateLimitResponse(limit);
    }

    // Resolve account through the existing PostgreSQL guard.
    // Preserve verified SSR identity and the existing 403 response.
    const getVerifiedSession = async () => ({ userId: user.id });
    const accountGuards =
      createDefaultPostgresAccountGuards(getVerifiedSession);
    let accountId: string;
    try {
      accountId = (await accountGuards.requireAccount()).accountId;
    } catch (error) {
      if (toAppError(error).code !== 'forbidden') throw error;
      return NextResponse.json(
        { error: 'Your profile is not linked to an account.' },
        { status: 403 }
      );
    }
    const body = await request.json();
    const {
      conversation_id,
      message_type,
      content_text,
      media_url,
      filename,
      template_name,
      template_language,
      template_params,
      template_message_params,
      reply_to_message_id,
    } = body;

    if (!conversation_id || !message_type) {
      return NextResponse.json(
        { error: 'conversation_id and message_type are required' },
        { status: 400 }
      );
    }

    // Media kinds (image/video/document/audio) are sent to Meta via a
    // public URL the composer already uploaded to the chat-media bucket.
    const MEDIA_KINDS = ['image', 'video', 'document', 'audio'] as const;
    const isMediaKind = (MEDIA_KINDS as readonly string[]).includes(
      message_type
    );

    // Reject anything outside the known set up front rather than letting
    // an unknown type fall through to the text path with empty content.
    const VALID_MESSAGE_TYPES = ['text', 'template', ...MEDIA_KINDS] as const;
    if (!(VALID_MESSAGE_TYPES as readonly string[]).includes(message_type)) {
      return NextResponse.json(
        { error: `Unsupported message_type "${message_type}"` },
        { status: 400 }
      );
    }

    if (message_type === 'text' && !content_text) {
      return NextResponse.json(
        { error: 'content_text is required for text messages' },
        { status: 400 }
      );
    }

    if (message_type === 'template' && !template_name) {
      return NextResponse.json(
        { error: 'template_name is required for template messages' },
        { status: 400 }
      );
    }

    if (isMediaKind && !media_url) {
      return NextResponse.json(
        { error: `media_url is required for ${message_type} messages` },
        { status: 400 }
      );
    }

    // Meta caps media captions at 1024 chars; reject before the upload is
    // wasted at the Meta call. (Audio carries no caption — see meta-api.)
    if (
      isMediaKind &&
      message_type !== 'audio' &&
      typeof content_text === 'string' &&
      content_text.length > 1024
    ) {
      return NextResponse.json(
        { error: 'Caption exceeds the 1024-character limit' },
        { status: 400 }
      );
    }

    // Fetch the conversation and contact inside the verified account.
    const conversationRepository =
      createPostgresWhatsAppSendConversationRepository({
        userId: user.id,
        accountId,
      });
    const messageRepository = createPostgresWhatsAppSendMessageRepository({
      userId: user.id,
      accountId,
    });
    const flowRunRepository = createPostgresWhatsAppSendFlowRunRepository({
      userId: user.id,
      accountId,
    });
    const conversation =
      await conversationRepository.findForSend(conversation_id);

    if (!conversation) {
      return NextResponse.json(
        { error: 'Conversation not found' },
        { status: 404 }
      );
    }
    const contact = conversation.contact;
    if (!contact?.phone) {
      return NextResponse.json(
        { error: 'Contact phone number not found' },
        { status: 400 }
      );
    }

    // Sanitize and validate phone
    const sanitizedPhone = sanitizePhoneForMeta(contact.phone);
    if (!isValidE164(sanitizedPhone)) {
      return NextResponse.json(
        { error: 'Invalid phone number format' },
        { status: 400 }
      );
    }

    // Fetch and decrypt WhatsApp config
    const configRepository =
      createPostgresWhatsAppConfigRepository(getVerifiedSession);
    const config = await configRepository.getConnectionConfig();

    if (!config) {
      return NextResponse.json(
        {
          error:
            'WhatsApp not configured. Please set up your WhatsApp integration first.',
        },
        { status: 400 }
      );
    }

    const accessToken = decrypt(config.encryptedAccessToken);

    // Self-heal legacy CBC-encrypted tokens without delaying the send.
    // RLS limits the best-effort upgrade to a role allowed to update this config.
    if (isLegacyFormat(config.encryptedAccessToken)) {
      void configRepository
        .upgradeLegacyToken(config.configId, encrypt(accessToken))
        .catch((error: unknown) => {
          console.warn(
            '[whatsapp/send] access_token GCM upgrade failed:',
            toAppError(error).message
          );
        });
    }
    let contextMessageId: string | undefined;
    if (reply_to_message_id) {
      const parent = await conversationRepository.findReplyTarget(
        conversation_id,
        reply_to_message_id
      );

      if (!parent) {
        return NextResponse.json(
          { error: 'reply_to_message_id not found in this conversation' },
          { status: 400 }
        );
      }
      if (!parent.messageId) {
        // Parent never reached Meta (still in 'sending' or 'failed') — we
        // can't quote it on WhatsApp. Send without context rather than
        // dropping the message entirely.
        console.warn(
          '[whatsapp/send] reply target has no Meta message_id; sending without context'
        );
      } else {
        contextMessageId = parent.messageId;
      }
    }
    // Send via Meta API — retry with phone-number variants if Meta rejects
    // with "recipient not in allowed list" (common in sandbox / when a
    // number was registered with/without a trunk 0). If an alternate
    // format succeeds, we persist it back to the contact row so the
    // next send goes through on the first attempt.
    let waMessageId = '';
    let workingPhone = sanitizedPhone;

    // Template sends need the validated definition to build headers and buttons.
    // A missing template preserves the existing legacy body-only path.
    let templateRow: TemplateSendDefinition | null = null;
    if (message_type === 'template' && template_name) {
      const templateRepository =
        createPostgresTemplateSendDefinitionRepository(getVerifiedSession);
      templateRow = await templateRepository.findForCurrentAccount({
        name: template_name,
        language: template_language,
      });
    }

    // Take control before contacting Meta. If an active Flow run cannot be
    // confirmed paused under PostgreSQL RLS, do not send the agent's reply.
    try {
      await flowRunRepository.pauseActiveForAgentReply(
        contact.id,
        new Date().toISOString()
      );
    } catch (error) {
      console.error(
        '[flows] pause-on-agent-send failed:',
        toAppError(error).message
      );
      return NextResponse.json(
        { error: 'Unable to pause the active automation before sending.' },
        { status: 503 }
      );
    }

    const attempt = async (phone: string): Promise<string> => {
      if (message_type === 'template') {
        const result = await sendTemplateMessage({
          phoneNumberId: config.phoneNumberId,
          accessToken,
          to: phone,
          templateName: template_name,
          language: template_language || 'en_US',
          template: templateRow ?? undefined,
          messageParams: template_message_params ?? undefined,
          // Legacy body-only fallback — only consulted when
          // messageParams.body isn't set.
          params: template_params || [],
          contextMessageId,
        });
        return result.messageId;
      }
      if (isMediaKind) {
        // content_text doubles as the caption (ignored for audio inside
        // sendMediaMessage). filename surfaces in the recipient's chat
        // for documents only.
        const result = await sendMediaMessage({
          phoneNumberId: config.phoneNumberId,
          accessToken,
          to: phone,
          kind: message_type as MediaKind,
          link: media_url,
          caption: content_text || undefined,
          filename: filename || undefined,
          contextMessageId,
        });
        return result.messageId;
      }
      const result = await sendTextMessage({
        phoneNumberId: config.phoneNumberId,
        accessToken,
        to: phone,
        text: content_text,
        contextMessageId,
      });
      return result.messageId;
    };

    try {
      const variants = phoneVariants(sanitizedPhone);
      let lastError: unknown = null;

      for (const variant of variants) {
        try {
          waMessageId = await attempt(variant);
          workingPhone = variant;
          lastError = null;
          break;
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          // Only retry when the failure is specifically that the
          // recipient isn't in Meta's allowed list. Any other error
          // (bad token, invalid template, etc.) bubbles up immediately.
          if (!isRecipientNotAllowedError(message)) {
            throw err;
          }
          lastError = err;
          console.warn(
            `[whatsapp/send] variant "${variant}" rejected by Meta, trying next…`
          );
        }
      }

      if (lastError) throw lastError;
    } catch (err) {
      const message =
        err instanceof Error ? err.message : 'Unknown Meta API error';
      console.error('Meta API send failed for all variants:', message);
      return NextResponse.json(
        { error: `Meta API error: ${message}` },
        { status: 502 }
      );
    }

    // If a non-original variant succeeded, update the contact so future
    // sends go straight through. sanitizePhoneForMeta on workingPhone
    // will yield workingPhone itself, so re-storing preserves it.
    if (workingPhone !== sanitizedPhone) {
      console.log(
        `[whatsapp/send] Auto-corrected contact phone: ${sanitizedPhone} → ${workingPhone}`
      );
      try {
        await conversationRepository.updateContactPhone(
          contact.id,
          workingPhone
        );
      } catch (error) {
        console.warn(
          '[whatsapp/send] contact phone auto-correction failed:',
          toAppError(error).message
        );
      }
    }

    let messageRecordId: string;
    try {
      messageRecordId = await messageRepository.insertSentMessage({
        conversationId: conversation_id,
        contentType: message_type,
        contentText: content_text || null,
        mediaUrl: media_url || null,
        templateName: template_name || null,
        providerMessageId: waMessageId,
        replyToMessageId: reply_to_message_id || null,
      });
    } catch (error) {
      const safeError = toAppError(error);
      console.error('Error inserting sent message:', safeError.message);
      return NextResponse.json(
        {
          error: `Message sent to Meta but failed to save to DB: ${safeError.message}`,
        },
        { status: 500 }
      );
    }

    // Keep the accepted send successful if this best-effort snapshot fails.
    try {
      await conversationRepository.updateAfterSend({
        conversationId: conversation_id,
        lastMessageText: content_text || `[${message_type}]`,
        lastMessageAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      });
    } catch (error) {
      console.warn(
        '[whatsapp/send] conversation update failed:',
        toAppError(error).message
      );
    }

    return NextResponse.json({
      success: true,
      message_id: messageRecordId,
      whatsapp_message_id: waMessageId,
    });
  } catch (error) {
    console.error('Error in WhatsApp send POST:', error);
    return NextResponse.json(
      { error: 'Failed to send message' },
      { status: 500 }
    );
  }
}
