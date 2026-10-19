import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { test } from 'node:test';
import {
  readSchedulerConfig,
  runHeartbeatCron,
  runHeartbeatScheduler,
} from './zap-lead-heartbeat-scheduler.mjs';

const httpsUrl = 'https://wacrm.example.test/api/zap-lead/heartbeat/cron';

test('requires an exact heartbeat endpoint and a secret without exposing either', () => {
  assert.throws(
    () => readSchedulerConfig({}),
    /ZAP_LEAD_HEARTBEAT_CRON_URL is required/
  );
  assert.throws(
    () => readSchedulerConfig({ ZAP_LEAD_HEARTBEAT_CRON_URL: httpsUrl }),
    /AUTOMATION_CRON_SECRET is required/
  );
  assert.throws(
    () =>
      readSchedulerConfig({
        ZAP_LEAD_HEARTBEAT_CRON_URL: `${httpsUrl}?secret=hidden`,
        AUTOMATION_CRON_SECRET: 'hidden',
      }),
    /must target the heartbeat cron route/
  );
});

test('uses HTTPS by default and bounds the scheduler cadence to one minute', () => {
  assert.throws(
    () =>
      readSchedulerConfig({
        ZAP_LEAD_HEARTBEAT_CRON_URL:
          'http://wacrm:3000/api/zap-lead/heartbeat/cron',
        AUTOMATION_CRON_SECRET: 'local-secret',
      }),
    /HTTPS is required/
  );

  const config = readSchedulerConfig({
    ZAP_LEAD_HEARTBEAT_CRON_URL:
      'http://wacrm:3000/api/zap-lead/heartbeat/cron',
    ZAP_LEAD_HEARTBEAT_ALLOW_INSECURE_HTTP: 'true',
    ZAP_LEAD_HEARTBEAT_INTERVAL_MS: '30000',
    AUTOMATION_CRON_SECRET: 'local-secret',
  });
  assert.equal(config.intervalMs, 30_000);
  assert.equal(config.timeoutMs, 10_000);
  assert.throws(
    () =>
      readSchedulerConfig({
        ZAP_LEAD_HEARTBEAT_CRON_URL: httpsUrl,
        ZAP_LEAD_HEARTBEAT_INTERVAL_MS: '60001',
        AUTOMATION_CRON_SECRET: 'local-secret',
      }),
    /must not exceed/
  );
  assert.throws(
    () =>
      readSchedulerConfig({
        ZAP_LEAD_HEARTBEAT_CRON_URL: httpsUrl,
        ZAP_LEAD_HEARTBEAT_TIMEOUT_MS: '60001',
        AUTOMATION_CRON_SECRET: 'local-secret',
      }),
    /ZAP_LEAD_HEARTBEAT_TIMEOUT_MS must not exceed/
  );
});

test('calls only the configured route with the cron header and request timeout', async () => {
  let captured;
  const result = await runHeartbeatCron({
    url: httpsUrl,
    secret: 'local-secret',
    timeoutMs: 1234,
    fetchImpl: async (url, options) => {
      captured = { url, options };
      return { ok: true, status: 200 };
    },
  });

  assert.deepEqual(result, { status: 200 });
  assert.equal(captured.url, httpsUrl);
  assert.equal(captured.options.method, 'GET');
  assert.equal(captured.options.headers['x-cron-secret'], 'local-secret');
  assert.equal(captured.options.cache, 'no-store');
  assert.equal(captured.options.redirect, 'error');
  assert.equal(captured.options.signal.aborted, false);
});

test('sends an authenticated request to a local HTTP endpoint mock', async (t) => {
  const server = createServer((request, response) => {
    assert.equal(request.method, 'GET');
    assert.equal(request.url, '/api/zap-lead/heartbeat/cron');
    assert.equal(request.headers['x-cron-secret'], 'local-test-secret');
    response.writeHead(200, { 'content-type': 'application/json' });
    response.end(
      JSON.stringify({ checked: 0, healthy: 0, failed: 0, alertsRaised: 0 })
    );
  });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  t.after(
    () =>
      new Promise((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      })
  );

  const address = server.address();
  assert.ok(address && typeof address === 'object');
  const result = await runHeartbeatCron({
    url: `http://127.0.0.1:${address.port}/api/zap-lead/heartbeat/cron`,
    secret: 'local-test-secret',
  });
  assert.deepEqual(result, { status: 200 });
});

test('rejects redirects without forwarding the cron secret', async (t) => {
  let requestCount = 0;
  const server = createServer((_request, response) => {
    requestCount += 1;
    response.writeHead(302, { location: 'http://127.0.0.1:1/exfiltrate' });
    response.end();
  });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  t.after(
    () =>
      new Promise((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      })
  );

  const address = server.address();
  assert.ok(address && typeof address === 'object');
  await assert.rejects(
    () =>
      runHeartbeatCron({
        url: `http://127.0.0.1:${address.port}/api/zap-lead/heartbeat/cron`,
        secret: 'local-test-secret',
      }),
    /Heartbeat cron request failed/
  );
  assert.equal(requestCount, 1);
});

test('aborts an in-flight request when shutdown is requested', async () => {
  const controller = new AbortController();
  const request = runHeartbeatCron({
    url: httpsUrl,
    secret: 'local-secret',
    timeoutMs: 60_000,
    signal: controller.signal,
    fetchImpl: (_url, options) =>
      new Promise((_resolve, reject) => {
        options.signal.addEventListener(
          'abort',
          () => reject(new Error('aborted')),
          { once: true }
        );
      }),
  });
  controller.abort();
  await assert.rejects(request, /Heartbeat cron request failed/);
});

test('does not consume an error response body and reports only its status', async () => {
  const response = {
    ok: false,
    status: 503,
    text: () => {
      throw new Error('response body must not be read');
    },
  };
  await assert.rejects(
    () =>
      runHeartbeatCron({
        url: httpsUrl,
        secret: 'local-secret',
        fetchImpl: async () => response,
      }),
    /Heartbeat cron returned HTTP 503/
  );
});

test('subtracts sweep duration from the configured heartbeat interval', async () => {
  const controller = new AbortController();
  const waits = [];
  let now = 0;
  let calls = 0;

  await runHeartbeatScheduler({
    intervalMs: 100,
    signal: controller.signal,
    now: () => now,
    runOnce: async () => {
      calls += 1;
      if (calls === 1) now += 40;
      else controller.abort();
    },
    wait: async (milliseconds) => {
      waits.push(milliseconds);
      now += milliseconds;
    },
  });

  assert.equal(calls, 2);
  assert.deepEqual(waits, [60]);
});

test('runs sequentially, reports failures and stops promptly on abort', async () => {
  const controller = new AbortController();
  const events = [];
  let active = 0;
  let maxActive = 0;

  await runHeartbeatScheduler({
    intervalMs: 10,
    signal: controller.signal,
    runOnce: async (signal) => {
      assert.equal(signal, controller.signal);
      active += 1;
      maxActive = Math.max(maxActive, active);
      await Promise.resolve();
      active -= 1;
      events.push('run');
      if (events.filter((event) => event === 'run').length === 2)
        throw new Error('synthetic failure');
      if (events.filter((event) => event === 'run').length === 3)
        controller.abort();
      return { status: 200 };
    },
    wait: async (milliseconds) => events.push(`wait:${milliseconds}`),
    onSuccess: () => events.push('success'),
    onFailure: () => events.push('failure'),
  });

  assert.equal(maxActive, 1);
  assert.equal(events.filter((event) => event === 'run').length, 3);
  assert.equal(events.filter((event) => event === 'failure').length, 1);
  assert.equal(events.filter((event) => event.startsWith('wait:')).length, 2);
});
