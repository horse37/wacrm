import { randomBytes } from 'node:crypto';

export const ZAP_LEAD_REGISTRATION_PREFIX = 'zap-lead-agency:v1:';

export interface ZapLeadRegistration {
  version: 1;
  keyId: string;
  secret: string;
  webhookUrl: string | null;
  events: string[];
}

const EVENT_NAMES = new Set([
  'lead.created',
  'lead.stage.changed',
  'lead.stage.pending_confirmation',
  'response.deadline.exceeded',
  'lead.assigned',
  'seller.channel.disconnected',
  'analysis.completed',
]);
const KEY_ID = /^ak_[\da-f]{24}$/i;
const SECRET = /^[A-Za-z\d_-]{32,128}$/;

function normalizeWebhookUrl(value: unknown): string | null {
  if (typeof value !== 'string' || value.length > 2048) return null;

  try {
    const url = new URL(value);
    if (
      url.protocol === 'https:' &&
      !url.username &&
      !url.password &&
      !url.hash
    ) {
      return url.toString();
    }
    return null;
  } catch {
    return null;
  }
}

function validateRegistration(value: unknown): ZapLeadRegistration {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Invalid Zap Lead registration payload');
  }

  const candidate = value as Record<string, unknown>;
  const keys = Object.keys(candidate).sort();
  const normalizedWebhookUrl = normalizeWebhookUrl(candidate.webhookUrl);
  const valid =
    keys.join(',') === 'events,keyId,secret,version,webhookUrl' &&
    candidate.version === 1 &&
    typeof candidate.keyId === 'string' &&
    KEY_ID.test(candidate.keyId) &&
    typeof candidate.secret === 'string' &&
    SECRET.test(candidate.secret) &&
    normalizedWebhookUrl !== null &&
    Array.isArray(candidate.events) &&
    candidate.events.length > 0 &&
    candidate.events.every(
      (event) => typeof event === 'string' && EVENT_NAMES.has(event)
    );

  if (!valid) throw new Error('Invalid Zap Lead registration payload');

  return {
    version: 1,
    keyId: candidate.keyId as string,
    secret: candidate.secret as string,
    events: [...new Set(candidate.events as string[])],
    webhookUrl: normalizedWebhookUrl as string,
  };
}

export function createRegistrationCode(
  registration: ZapLeadRegistration
): string {
  const payload = validateRegistration(registration);
  const encoded = Buffer.from(JSON.stringify(payload), 'utf8').toString(
    'base64url'
  );
  return `${ZAP_LEAD_REGISTRATION_PREFIX}${encoded}`;
}

export function generateZapLeadRegistration(webhookUrl: string): string {
  return createRegistrationCode({
    version: 1,
    keyId: `ak_${randomBytes(12).toString('hex')}`,
    secret: randomBytes(32).toString('base64url'),
    webhookUrl,
    events: [...EVENT_NAMES],
  });
}

export function parseRegistrationCode(code: string): ZapLeadRegistration {
  if (typeof code !== 'string') {
    throw new Error('Invalid Zap Lead registration code');
  }

  const normalizedCode = code.trim();
  if (!normalizedCode.startsWith(ZAP_LEAD_REGISTRATION_PREFIX)) {
    throw new Error('Invalid Zap Lead registration code');
  }

  const encoded = normalizedCode.slice(ZAP_LEAD_REGISTRATION_PREFIX.length);
  if (
    !encoded ||
    encoded.length > 16_384 ||
    !/^[A-Za-z0-9_-]+$/.test(encoded)
  ) {
    throw new Error('Invalid Zap Lead registration code');
  }

  try {
    const json = Buffer.from(encoded, 'base64url').toString('utf8');
    return validateRegistration(JSON.parse(json) as unknown);
  } catch {
    throw new Error('Invalid Zap Lead registration code');
  }
}
