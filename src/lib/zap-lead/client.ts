import { createHash, createHmac, randomUUID } from 'node:crypto';

export type ZapLeadMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

const EVENT_CURSOR =
  /^[\da-f]{8}-[\da-f]{4}-[1-8][\da-f]{3}-[89ab][\da-f]{3}-[\da-f]{12}$/i;
export function isValidZapLeadEventCursor(value: string): boolean {
  return EVENT_CURSOR.test(value);
}

export interface ZapLeadClientOptions {
  baseUrl: string;
  keyId: string;
  secret: string;
  fetcher?: (url: URL, init: RequestInit) => Promise<Response>;
  nonce?: () => string;
  now?: () => Date;
  timeoutMs?: number;
}

export interface ZapLeadRequestOptions {
  idempotencyKey?: string;
  expectedStatus?: number;
}

function normalizeBaseUrl(value: string): URL {
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

  return url;
}

function assertRequestPath(path: string): URL {
  if (
    typeof path !== 'string' ||
    !path.startsWith('/api/agency/v1/') ||
    path.includes('\\') ||
    /[\u0000-\u001f\u007f]/.test(path) ||
    path.includes('#')
  ) {
    throw new Error('Invalid Zap Lead API path');
  }

  const target = new URL(path, 'https://zap-lead.invalid');
  if (
    target.origin !== 'https://zap-lead.invalid' ||
    !target.pathname.startsWith('/api/agency/v1/')
  ) {
    throw new Error('Invalid Zap Lead API path');
  }
  return target;
}

export function createZapLeadClient(options: ZapLeadClientOptions) {
  const baseUrl = normalizeBaseUrl(options.baseUrl);
  if (!options.keyId || !options.secret) {
    throw new Error('Zap Lead credentials are required');
  }

  const fetcher = options.fetcher ?? ((url, init) => fetch(url, init));
  const nonce = options.nonce ?? randomUUID;
  const now = options.now ?? (() => new Date());
  const timeoutMs = options.timeoutMs ?? 15_000;

  return {
    async request<T>(
      method: ZapLeadMethod,
      path: string,
      body?: unknown,
      requestOptions: ZapLeadRequestOptions = {}
    ): Promise<T> {
      if (!['GET', 'POST', 'PUT', 'PATCH', 'DELETE'].includes(method)) {
        throw new Error('Invalid Zap Lead API method');
      }
      const requestTarget = assertRequestPath(path);
      const url = new URL(
        requestTarget.pathname + requestTarget.search,
        baseUrl
      );
      const timestamp = now().toISOString();
      const requestNonce = nonce();
      const bodyText = body === undefined ? '' : JSON.stringify(body);
      if (typeof bodyText !== 'string') {
        throw new Error('Zap Lead API request body must be JSON serializable');
      }
      const bodyHash = createHash('sha256')
        .update(bodyText, 'utf8')
        .digest('hex');
      const canonical = [
        method,
        `${url.pathname}${url.search}`,
        timestamp,
        requestNonce,
        bodyHash,
      ].join('\n');
      const signature = createHmac('sha256', options.secret)
        .update(canonical, 'utf8')
        .digest('hex');
      const idempotencyKey = requestOptions.idempotencyKey?.trim();
      if (method !== 'GET' && idempotencyKey === undefined) {
        throw new Error('Zap Lead write requests require an idempotency key');
      }
      if (
        idempotencyKey !== undefined &&
        (idempotencyKey.length < 1 ||
          idempotencyKey.length > 128 ||
          !/^[\x21-\x7e]+$/.test(idempotencyKey))
      ) {
        throw new Error('Invalid Zap Lead idempotency key');
      }
      const headers = new Headers({
        Accept: 'application/json',
        'X-Agency-Key': options.keyId,
        'X-Agency-Timestamp': timestamp,
        'X-Agency-Nonce': requestNonce,
        'X-Agency-Signature': signature,
      });

      if (idempotencyKey !== undefined) {
        headers.set('Idempotency-Key', idempotencyKey);
      }

      if (bodyText) headers.set('Content-Type', 'application/json');

      const response = await fetcher(url, {
        method,
        headers,
        body: bodyText || undefined,
        cache: 'no-store',
        redirect: 'error',
        signal: AbortSignal.timeout(timeoutMs),
      });

      if (
        requestOptions.expectedStatus !== undefined
          ? response.status !== requestOptions.expectedStatus
          : !response.ok
      ) {
        throw new Error(`Zap Lead API request failed (${response.status})`);
      }
      if (response.status === 204) return undefined as T;

      try {
        return (await response.json()) as T;
      } catch {
        throw new Error('Zap Lead API returned an invalid JSON response');
      }
    },
    async openEvents(
      cursor: string | null = null,
      signal?: AbortSignal
    ): Promise<Response> {
      if (cursor !== null && !isValidZapLeadEventCursor(cursor)) {
        throw new Error('Invalid Zap Lead event cursor');
      }
      const path =
        '/api/agency/v1/events/stream' +
        (cursor === null ? '' : `?cursor=${encodeURIComponent(cursor)}`);
      const requestTarget = assertRequestPath(path);
      const url = new URL(
        requestTarget.pathname + requestTarget.search,
        baseUrl
      );
      const timestamp = now().toISOString();
      const requestNonce = nonce();
      const bodyHash = createHash('sha256').update('').digest('hex');
      const canonical = [
        'GET',
        `${url.pathname}${url.search}`,
        timestamp,
        requestNonce,
        bodyHash,
      ].join('\n');
      const signature = createHmac('sha256', options.secret)
        .update(canonical, 'utf8')
        .digest('hex');
      const headers = new Headers({
        Accept: 'text/event-stream',
        'X-Agency-Key': options.keyId,
        'X-Agency-Timestamp': timestamp,
        'X-Agency-Nonce': requestNonce,
        'X-Agency-Signature': signature,
      });
      const response = await fetcher(url, {
        method: 'GET',
        headers,
        cache: 'no-store',
        redirect: 'error',
        signal: signal ?? AbortSignal.timeout(timeoutMs),
      });
      if (!response.ok) {
        throw new Error(`Zap Lead API request failed (${response.status})`);
      }
      if (
        !response.headers
          .get('content-type')
          ?.toLowerCase()
          .startsWith('text/event-stream')
      ) {
        throw new Error('Zap Lead API returned an invalid event stream');
      }
      return response;
    },
  };
}
