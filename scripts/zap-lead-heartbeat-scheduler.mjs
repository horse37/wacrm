import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const HEARTBEAT_PATH = '/api/zap-lead/heartbeat/cron';
const DEFAULT_INTERVAL_MS = 60_000;
const MAX_INTERVAL_MS = 60_000;
const DEFAULT_TIMEOUT_MS = 10_000;
const MAX_TIMEOUT_MS = 60_000;

export function readSchedulerConfig(env = process.env) {
  const rawUrl = env.ZAP_LEAD_HEARTBEAT_CRON_URL?.trim();
  const secret = env.AUTOMATION_CRON_SECRET;
  if (!rawUrl) throw new Error('ZAP_LEAD_HEARTBEAT_CRON_URL is required');
  if (!secret) throw new Error('AUTOMATION_CRON_SECRET is required');

  let url;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new Error('ZAP_LEAD_HEARTBEAT_CRON_URL must be an absolute URL');
  }

  if (url.pathname !== HEARTBEAT_PATH || url.search || url.hash) {
    throw new Error(
      'ZAP_LEAD_HEARTBEAT_CRON_URL must target the heartbeat cron route'
    );
  }
  if (url.username || url.password) {
    throw new Error('ZAP_LEAD_HEARTBEAT_CRON_URL must not contain credentials');
  }
  if (
    url.protocol !== 'https:' &&
    !(
      url.protocol === 'http:' &&
      env.ZAP_LEAD_HEARTBEAT_ALLOW_INSECURE_HTTP === 'true'
    )
  ) {
    throw new Error(
      'HTTPS is required unless ZAP_LEAD_HEARTBEAT_ALLOW_INSECURE_HTTP=true is explicitly set for isolated Docker networking'
    );
  }

  const intervalMs = parsePositiveInteger(
    env.ZAP_LEAD_HEARTBEAT_INTERVAL_MS,
    DEFAULT_INTERVAL_MS
  );
  if (intervalMs > MAX_INTERVAL_MS) {
    throw new Error(
      `ZAP_LEAD_HEARTBEAT_INTERVAL_MS must not exceed ${MAX_INTERVAL_MS}`
    );
  }
  const timeoutMs = parsePositiveInteger(
    env.ZAP_LEAD_HEARTBEAT_TIMEOUT_MS,
    DEFAULT_TIMEOUT_MS
  );
  if (timeoutMs > MAX_TIMEOUT_MS) {
    throw new Error(
      `ZAP_LEAD_HEARTBEAT_TIMEOUT_MS must not exceed ${MAX_TIMEOUT_MS}`
    );
  }

  return { url: url.href, secret, intervalMs, timeoutMs };
}

function parsePositiveInteger(value, fallback) {
  if (value === undefined || value === '') return fallback;
  if (!/^\d+$/.test(value))
    throw new Error('Scheduler intervals must be positive integers');
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 1) {
    throw new Error('Scheduler intervals must be positive integers');
  }
  return parsed;
}

export async function runHeartbeatCron({
  url,
  secret,
  timeoutMs = DEFAULT_TIMEOUT_MS,
  fetchImpl = fetch,
  signal,
}) {
  const controller = new AbortController();
  const abortRequest = () => controller.abort();
  if (signal?.aborted) controller.abort();
  else signal?.addEventListener('abort', abortRequest, { once: true });
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchImpl(url, {
      method: 'GET',
      headers: { 'x-cron-secret': secret },
      cache: 'no-store',
      redirect: 'error',
      signal: controller.signal,
    });
    if (!response.ok)
      throw new Error(`Heartbeat cron returned HTTP ${response.status}`);
    return { status: response.status };
  } catch (error) {
    if (
      error instanceof Error &&
      error.message.startsWith('Heartbeat cron returned HTTP ')
    )
      throw error;
    throw new Error('Heartbeat cron request failed', { cause: error });
  } finally {
    clearTimeout(timeout);
    signal?.removeEventListener('abort', abortRequest);
  }
}

export async function runHeartbeatScheduler({
  intervalMs,
  runOnce,
  signal,
  wait = delay,
  onFailure = () => {},
  onSuccess = () => {},
  now = () => performance.now(),
}) {
  while (!signal.aborted) {
    const startedAt = now();
    try {
      onSuccess(await runOnce(signal));
    } catch (error) {
      onFailure(error);
    }
    const remainingMs = Math.max(0, intervalMs - (now() - startedAt));
    if (!signal.aborted && remainingMs > 0) await wait(remainingMs, signal);
  }
}

function delay(milliseconds, signal) {
  return new Promise((resolveDelay) => {
    if (signal.aborted) return resolveDelay();

    const finish = () => {
      clearTimeout(timeout);
      signal.removeEventListener('abort', finish);
      resolveDelay();
    };
    const timeout = setTimeout(finish, milliseconds);
    signal.addEventListener('abort', finish, { once: true });
  });
}

async function main() {
  let config;
  try {
    config = readSchedulerConfig();
  } catch (error) {
    console.error(`Heartbeat scheduler configuration error: ${error.message}`);
    process.exitCode = 1;
    return;
  }

  const controller = new AbortController();
  const stop = () => controller.abort();
  process.once('SIGINT', stop);
  process.once('SIGTERM', stop);
  console.log(
    `Zap Lead heartbeat scheduler started; interval=${config.intervalMs}ms.`
  );

  await runHeartbeatScheduler({
    intervalMs: config.intervalMs,
    signal: controller.signal,
    runOnce: (signal) => runHeartbeatCron({ ...config, signal }),
    onSuccess: ({ status }) =>
      console.log(`Heartbeat sweep completed; HTTP ${status}.`),
    onFailure: (error) =>
      console.error(`Heartbeat sweep failed: ${error.message}`),
  });
  process.off('SIGINT', stop);
  process.off('SIGTERM', stop);
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  main().catch((error) => {
    console.error(`Heartbeat scheduler stopped: ${error.message}`);
    process.exitCode = 1;
  });
}
