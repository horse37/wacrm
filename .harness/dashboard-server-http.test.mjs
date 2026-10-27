import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { get } from 'node:http';
import { copyFile, mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');

function request(url, host) {
  return new Promise((resolveRequest, rejectRequest) => {
    const req = get(url, { headers: { host } }, (response) => {
      let body = '';
      response.setEncoding('utf8');
      response.on('data', (chunk) => {
        body += chunk;
      });
      response.on('end', () => {
        resolveRequest({
          status: response.statusCode,
          body,
          headers: response.headers,
        });
      });
    });
    req.setTimeout(15000, () =>
      req.destroy(new Error('Dashboard request timed out'))
    );
    req.on('error', rejectRequest);
  });
}

async function startServer(t, options = {}) {
  const tempRoot = await mkdtemp(join(tmpdir(), 'wacrm-dashboard-http-'));
  const safeTempRoot = resolve(tempRoot);
  const safeTempPrefix = `${resolve(tmpdir())}${sep}`;
  assert.ok(
    safeTempRoot.toLowerCase().startsWith(safeTempPrefix.toLowerCase()),
    'test temp directory must stay under the OS temp root'
  );
  const localAppData = join(tempRoot, 'appdata');
  const fixtureRepository = join(tempRoot, 'repository');
  const fixtureHarness = join(fixtureRepository, '.harness');
  const fixtureTask = join(fixtureHarness, 'tasks', 'dashboard-fixture');
  await mkdir(localAppData);
  await mkdir(fixtureTask, { recursive: true });
  for (const moduleName of [
    'dashboard-server.mjs',
    'dashboard-text-file.mjs',
    'dashboard-validation-files.mjs',
    'dashboard-http.mjs',
    'dashboard-review-progress.mjs',
    'dashboard-validation-result.mjs',
  ]) {
    await copyFile(
      join(repositoryRoot, '.harness', moduleName),
      join(fixtureHarness, moduleName)
    );
  }
  if (options.failCurrentTaskReadAfterStartup) {
    await writeFile(
      join(fixtureHarness, 'dashboard-text-file.mjs'),
      `import { readFile } from 'node:fs/promises';
let currentTaskReads = 0;
export async function readDashboardText(path, readFileImplementation = readFile) {
  if (path.endsWith('current-task.md') && ++currentTaskReads > 1) {
    const error = Object.assign(new Error('synthetic access denied'), { code: 'EACCES' });
    throw error;
  }
  return readFileImplementation(path, 'utf8');
}
`
    );
  }
  await writeFile(
    join(fixtureHarness, 'current-task.md'),
    '# Current task\n- id: dashboard-fixture\n- status: in_progress\n- goal: exercise dashboard status\n'
  );
  await writeFile(
    join(fixtureTask, 'task.md'),
    '# Fixture task\n\n## Próxima ação\nVerificar painel.\n'
  );
  await writeFile(
    join(fixtureTask, 'validation-fixture.log'),
    'Overall result: PASS\nTests 1 passed\n'
  );
  await writeFile(
    join(fixtureTask, 'review-fixture.md'),
    'Scope: dashboard fixture\nVerdict: APPROVE\nFindings: 0\nCaveats: 0\n'
  );

  const child = spawn(
    process.execPath,
    [join(fixtureHarness, 'dashboard-server.mjs')],
    {
      cwd: fixtureRepository,
      env: {
        ...process.env,
        LOCALAPPDATA: localAppData,
        WACRM_DASHBOARD_PORT: '0',
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    }
  );
  let stdout = '';
  let stderr = '';
  child.stdout.setEncoding('utf8').on('data', (chunk) => {
    stdout += chunk;
  });
  child.stderr.setEncoding('utf8').on('data', (chunk) => {
    stderr += chunk;
  });

  t.after(async () => {
    if (child.exitCode === null) {
      child.kill('SIGTERM');
      await Promise.race([
        once(child, 'exit'),
        new Promise((r) => setTimeout(r, 5000)),
      ]);
    }
    await rm(safeTempRoot, { recursive: true, force: true });
  });

  const dashboardUrl = await new Promise((resolveUrl, rejectUrl) => {
    const timeout = setTimeout(
      () => rejectUrl(new Error(`Dashboard did not start. ${stderr}`)),
      30000
    );
    const findUrl = () => {
      const match = stdout.match(
        /Painel disponível em: (http:\/\/127\.0\.0\.1:\d+\/dashboard\.html)/
      );
      if (!match) return;
      clearTimeout(timeout);
      resolveUrl(match[1]);
    };
    child.stdout.on('data', findUrl);
    child.once('error', rejectUrl);
    child.once('exit', (code) => {
      rejectUrl(new Error(`Dashboard exited with ${code}. ${stderr}`));
    });
    findUrl();
  });

  return { dashboardUrl, localAppData, fixtureHarness };
}

test('dashboard handles page refresh, hostile Host, and refresh failure', async (t) => {
  const { dashboardUrl, localAppData, fixtureHarness } = await startServer(t);
  const authority = new URL(dashboardUrl).host;

  const page = await request(dashboardUrl, authority);
  assert.equal(page.status, 200);
  assert.match(page.body, /Estado agregado da revisão desta task:/);
  assert.doesNotMatch(page.body, /Última revisão da fatia registrada:/);
  assert.match(page.body, /fetch\('\/api\/status',\s*\{cache:'no-store'\}\)/);
  assert.equal(page.body.includes('__INITIAL_STATUS__'), false);
  assert.match(page.body, /setInterval\(refresh, 20 \* 60 \* 1000\)/);

  const requestStartedAt = Date.now();
  const api = await request(new URL('/api/status', dashboardUrl), authority);
  const requestFinishedAt = Date.now();
  assert.equal(api.status, 200);
  assert.equal(api.headers['cache-control'], 'no-store');
  const status = JSON.parse(api.body);
  assert.ok(status.validations.length > 0);
  assert.ok(
    status.validations.some(
      (validation) =>
        validation.name === 'validation-fixture.log' &&
        validation.result === 'PASS'
    ),
    'status API exposes fixture validation evidence'
  );
  assert.ok(
    status.validations.some(
      (validation) =>
        validation.name === 'review-fixture.md' &&
        validation.result === 'APPROVE'
    )
  );
  const checkedAt = Date.parse(status.checkedAt);
  assert.ok(Number.isFinite(checkedAt));
  assert.ok(checkedAt >= requestStartedAt - 1000);
  assert.ok(checkedAt <= requestFinishedAt);

  const hostileHost = await request(dashboardUrl, 'attacker.example');
  assert.equal(hostileHost.status, 403);

  await writeFile(
    join(fixtureHarness, 'current-task.md'),
    '# Current task\n- id: missing-validation-directory\n- status: in_progress\n'
  );
  const failedValidationRead = await request(
    new URL('/api/status', dashboardUrl),
    authority
  );
  assert.equal(failedValidationRead.status, 500);
  assert.deepEqual(JSON.parse(failedValidationRead.body), {
    error: 'Falha ao atualizar o painel',
  });

  const runtimeRoot = join(localAppData, 'Wacrm', 'migration-dashboard');
  await rm(runtimeRoot, { recursive: true, force: true });
  await writeFile(runtimeRoot, 'block directory creation');
  const failedRefresh = await request(dashboardUrl, authority);
  assert.equal(failedRefresh.status, 500);
  assert.deepEqual(JSON.parse(failedRefresh.body), {
    error: 'Falha ao atualizar o painel',
  });
});

test('status returns sanitized HTTP 500 when a task file read fails', async (t) => {
  const { dashboardUrl } = await startServer(t, {
    failCurrentTaskReadAfterStartup: true,
  });
  const authority = new URL(dashboardUrl).host;
  const response = await request(
    new URL('/api/status', dashboardUrl),
    authority
  );

  assert.equal(response.status, 500);
  assert.deepEqual(JSON.parse(response.body), {
    error: 'Falha ao atualizar o painel',
  });
});
