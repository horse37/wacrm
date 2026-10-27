import { requireRole } from '@/lib/auth/account';
import { createPostgresZapLeadEventStreamReadRepository } from '@/lib/repositories/zap-lead-event-stream-read';
import { lookupZapLeadWebhookCredential } from '@/lib/repositories/zap-lead-webhook-credential-read';
import type { AccountRole } from '@/lib/auth/roles';
import { decrypt, encrypt } from '@/lib/whatsapp/encryption';
import { zapLeadAdminClient } from './admin-client';
import { createZapLeadClient } from './client';
import { createRegistrationCode, parseRegistrationCode } from './registration';

interface StoredCredential {
  api_base_url: string;
  encrypted_registration: string;
}

interface StoredHealthTarget {
  account_id: string;
  key_id: string;
  api_base_url: string;
  encrypted_registration: string;
}

export interface ZapLeadHealthTarget {
  accountId: string;
  keyId: string;
  client: ReturnType<typeof createZapLeadClient> | null;
}

export interface ZapLeadEventStreamTarget {
  accountId: string;
  keyId: string;
  cursor: string | null;
  client: ReturnType<typeof createZapLeadClient>;
}

function normalizeApiBaseUrl(value: string): string {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error('Invalid Zap Lead API URL');
  }

  if (
    url.protocol !== 'https:' ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    (url.pathname !== '/' && url.pathname !== '')
  ) {
    throw new Error(
      'Zap Lead API URL must use HTTPS and contain only an origin'
    );
  }
  return url.origin;
}

export async function saveZapLeadCredentials(
  registrationCode: string,
  apiBaseUrl: string
): Promise<void> {
  const account = await requireRole('admin');
  const registration = parseRegistrationCode(registrationCode);
  const encryptedRegistration = encrypt(JSON.stringify(registration));
  const normalizedUrl = normalizeApiBaseUrl(apiBaseUrl);
  const registeredAt = new Date().toISOString();

  const { error } = await account.supabase.from('zap_lead_integrations').upsert(
    {
      account_id: account.accountId,
      key_id: registration.keyId,
      api_base_url: normalizedUrl,
      encrypted_registration: encryptedRegistration,
      created_at: registeredAt,
      updated_at: registeredAt,
    },
    { onConflict: 'account_id' }
  );

  if (error) throw new Error('Could not save Zap Lead credentials');
}

export async function getZapLeadClientForCurrentAccount() {
  return loadZapLeadClientForCurrentAccount('admin');
}

export async function getZapLeadReadClientForCurrentAccount() {
  const client = await loadZapLeadClientForCurrentAccount('viewer');
  if (!client) return null;

  return {
    get<T>(path: string): Promise<T> {
      return client.request<T>('GET', path);
    },
  };
}

export async function getZapLeadWriteClientForCurrentAccount() {
  const client = await loadZapLeadClientForCurrentAccount('admin');
  if (!client) return null;

  return {
    createLead<T>(body: unknown, idempotencyKey: string): Promise<T> {
      return client.request<T>('POST', '/api/agency/v1/leads', body, {
        idempotencyKey,
        expectedStatus: 201,
      });
    },
  };
}

async function loadZapLeadClientForCurrentAccount(minimumRole: AccountRole) {
  const account = await requireRole(minimumRole);
  const { data, error } = await account.supabase
    .from('zap_lead_integrations')
    .select('api_base_url, encrypted_registration')
    .eq('account_id', account.accountId)
    .maybeSingle();

  if (error) throw new Error('Could not load Zap Lead credentials');
  if (!data) return null;

  const stored = data as StoredCredential;
  let registration;
  try {
    const decrypted = decrypt(stored.encrypted_registration);
    registration = parseRegistrationCode(
      createRegistrationCode(JSON.parse(decrypted))
    );
  } catch {
    throw new Error('Stored Zap Lead credentials are invalid');
  }

  return createZapLeadClient({
    baseUrl: normalizeApiBaseUrl(stored.api_base_url),
    keyId: registration.keyId,
    secret: registration.secret,
  });
}

export async function getZapLeadEventStreamTargetForCurrentAccount(): Promise<ZapLeadEventStreamTarget | null> {
  const account = await requireRole('admin');
  const repository = createPostgresZapLeadEventStreamReadRepository({
    userId: account.userId,
    accountId: account.accountId,
  });
  let stored;
  try {
    stored = await repository.getIntegration();
  } catch {
    throw new Error('Could not load Zap Lead event stream target');
  }
  if (!stored) return null;

  let registration;
  try {
    const decrypted = decrypt(stored.encryptedRegistration);
    registration = parseRegistrationCode(
      createRegistrationCode(JSON.parse(decrypted))
    );
  } catch {
    throw new Error('Stored Zap Lead credentials are invalid');
  }

  let cursor: string | null;
  try {
    cursor = await repository.getCursor(registration.keyId);
  } catch {
    throw new Error('Could not load Zap Lead event stream cursor');
  }

  return {
    accountId: stored.accountId,
    keyId: registration.keyId,
    cursor,
    client: createZapLeadClient({
      baseUrl: normalizeApiBaseUrl(stored.apiBaseUrl),
      keyId: registration.keyId,
      secret: registration.secret,
    }),
  };
}

export async function getZapLeadWebhookCredential(keyId: string) {
  if (!/^ak_[\da-f]{24}$/i.test(keyId)) return null;

  const stored = await lookupZapLeadWebhookCredential(keyId);
  if (!stored) return null;
  try {
    const decrypted = decrypt(stored.encryptedRegistration);
    const registration = parseRegistrationCode(
      createRegistrationCode(JSON.parse(decrypted))
    );
    if (registration.keyId !== keyId) return null;
    return { accountId: stored.accountId, registration };
  } catch {
    throw new Error('Stored Zap Lead webhook credentials are invalid');
  }
}

export async function getZapLeadHealthTargets(): Promise<
  ZapLeadHealthTarget[]
> {
  const { data, error } = await zapLeadAdminClient()
    .from('zap_lead_integrations')
    .select('account_id, key_id, api_base_url, encrypted_registration');

  if (error) throw new Error('Could not list Zap Lead health targets');

  return ((data ?? []) as StoredHealthTarget[]).map((stored) => {
    try {
      const decrypted = decrypt(stored.encrypted_registration);
      const registration = parseRegistrationCode(
        createRegistrationCode(JSON.parse(decrypted))
      );
      if (registration.keyId !== stored.key_id) {
        return {
          accountId: stored.account_id,
          keyId: stored.key_id,
          client: null,
        };
      }
      return {
        accountId: stored.account_id,
        keyId: stored.key_id,
        client: createZapLeadClient({
          baseUrl: normalizeApiBaseUrl(stored.api_base_url),
          keyId: registration.keyId,
          secret: registration.secret,
        }),
      };
    } catch {
      return {
        accountId: stored.account_id,
        keyId: stored.key_id,
        client: null,
      };
    }
  });
}

export async function removeZapLeadCredentials(): Promise<void> {
  const account = await requireRole('admin');
  const { error } = await account.supabase
    .from('zap_lead_integrations')
    .delete()
    .eq('account_id', account.accountId);

  if (error) throw new Error('Could not remove Zap Lead credentials');
}
