import { execFileSync } from 'node:child_process';
import { createServer } from 'node:http';
import { mkdir, readdir, stat, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, join, resolve, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { collectValidationFiles } from './dashboard-validation-files.mjs';
import { readDashboardText } from './dashboard-text-file.mjs';
import {
  isAllowedDashboardHost,
  renderDashboardPage,
} from './dashboard-http.mjs';
import {
  classifyReview,
  isHData003Task,
  reviewFilesForTask,
  summarizeReviewProgress,
  taskStatus,
  taskStatusLabel,
} from './dashboard-review-progress.mjs';

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const taskRoot = join(repositoryRoot, '.harness', 'tasks');
const runtimeRoot = process.env.LOCALAPPDATA
  ? join(process.env.LOCALAPPDATA, 'Wacrm', 'migration-dashboard')
  : join(homedir(), '.wacrm', 'migration-dashboard');
const statusPath = join(runtimeRoot, 'status.json');
const serverInfoPath = join(runtimeRoot, 'server.json');
const refreshMs = 20 * 60 * 1000;

function git(args) {
  try {
    return execFileSync('git', ['-C', repositoryRoot, ...args], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
      windowsHide: true,
    }).trim();
  } catch {
    return 'indisponível';
  }
}

async function readText(path) {
  return readDashboardText(path);
}

function section(text, heading) {
  const start = text.search(new RegExp(`^## ${heading}\\s*$`, 'm'));
  if (start < 0) return '';
  const bodyStart = text.indexOf('\n', start) + 1;
  const nextHeading = text.indexOf('\n## ', bodyStart);
  return text
    .slice(bodyStart, nextHeading < 0 ? undefined : nextHeading)
    .trim();
}

function field(text, key) {
  const value = text.match(new RegExp(`^- ${key}:\\s*(.+)$`, 'm'))?.[1]?.trim();
  return value?.replaceAll('`', '') ?? '';
}

function reviewLabel(value) {
  if (value === 'APPROVE') return 'Aprovada';
  if (value === 'REMEDIATION_REQUIRED') return 'Correções necessárias';
  if (value === 'pendente') return 'Pendente';
  return 'Não registrada';
}

function resultLabel(value) {
  if (value === 'PASS') return 'Passou';
  if (value === 'APPROVE') return 'Aprovada';
  if (value === 'FAIL') return 'Falhou';
  if (value === 'remediação requerida') return 'Correções necessárias';
  return 'Evidência registrada';
}

function evidenceLabel(name) {
  if (/postgres-whatsapp-config-post/i.test(name))
    return 'Integração PostgreSQL da configuração do WhatsApp';
  if (/shared-importers/i.test(name))
    return 'Testes dos módulos que usam componentes compartilhados';
  if (/focused/i.test(name)) return 'Testes focados da fatia';
  if (/typecheck/i.test(name)) return 'Verificação de tipos TypeScript';
  if (/eslint/i.test(name)) return 'Análise estática de código';
  if (/prettier/i.test(name)) return 'Verificação de formatação';
  if (/diff-check/i.test(name)) return 'Verificação de alterações';
  if (/tdd-red/i.test(name))
    return 'Teste de falha esperado antes da implementação';
  if (/review/i.test(name)) return 'Revisão independente';
  return 'Registro de validação da tarefa';
}

function activityLabel(file) {
  if (/handoffs[/\\]implementer\.md/i.test(file))
    return 'Ponto de continuidade atualizado';
  if (/review.*\.md/i.test(file)) return 'Registro da revisão independente';
  if (/task\.md/i.test(file)) return 'Registro da tarefa atualizado';
  if (/validation.*\.log/i.test(file)) return evidenceLabel(file);
  if (/tdd.*\.(?:log|md)/i.test(file))
    return 'Registro do teste antes da implementação';
  return 'Arquivo da tarefa atualizado';
}

async function collectReviewProgress(taskDirectories) {
  const tasks = [];

  for (const directory of taskDirectories) {
    const taskText = await readText(join(directory.path, 'task.md'));
    const isRoadmapTask = isHData003Task(taskText);
    if (!isRoadmapTask && directory.name !== currentTaskId) continue;

    const rootEntries = await readdir(directory.path, { withFileTypes: true });
    let handoffEntries;
    try {
      handoffEntries = await readdir(join(directory.path, 'handoffs'), {
        withFileTypes: true,
      });
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
      handoffEntries = [];
    }
    const reviewFiles = reviewFilesForTask(rootEntries, handoffEntries);
    const reviews = await Promise.all(
      reviewFiles.map(async (name) => ({
        name,
        text: await readText(join(directory.path, name)),
      }))
    );
    tasks.push({
      id: directory.name,
      isRoadmapTask,
      status: taskStatus(taskText),
      reviews,
    });
  }

  return summarizeReviewProgress(tasks, currentTaskId);
}

let currentTaskId = '';

async function listTaskDirectories() {
  return (await readdir(taskRoot, { withFileTypes: true }))
    .filter((entry) => entry.isDirectory())
    .map((entry) => ({ name: entry.name, path: join(taskRoot, entry.name) }));
}

async function collectRecentActivity(taskDirectory) {
  const entries = await readdir(taskDirectory, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    if (!entry.isFile()) continue;
    const path = join(taskDirectory, entry.name);
    const metadata = await stat(path);
    files.push({
      file: relative(repositoryRoot, path).replaceAll('\\', '/'),
      updatedAt: metadata.mtime.toISOString(),
    });
  }
  return files
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
    .slice(0, 8);
}

async function collectStatus() {
  const currentMarkdown = await readText(
    join(repositoryRoot, '.harness', 'current-task.md')
  );
  const activeBlock = currentMarkdown.split('\n---\n', 1)[0];
  currentTaskId = field(activeBlock, 'id');
  const taskDirectory = join(taskRoot, currentTaskId);
  const taskMarkdown = await readText(join(taskDirectory, 'task.md'));
  const nextAction =
    section(taskMarkdown, 'Próxima ação') ||
    section(taskMarkdown, 'Next action') ||
    field(activeBlock, 'next action') ||
    field(activeBlock, 'goal');
  const activity = git(['status', '--short', '--untracked-files=all'])
    .split(/\r?\n/)
    .filter(Boolean);
  const taskDirectories = await listTaskDirectories();
  const [reviews, validations, recentActivity] = await Promise.all([
    collectReviewProgress(taskDirectories),
    collectValidationFiles(taskDirectory),
    collectRecentActivity(taskDirectory),
  ]);

  return {
    repository: repositoryRoot,
    checkedAt: new Date().toISOString(),
    timezone: 'America/Sao_Paulo',
    git: {
      branch: git(['branch', '--show-current']),
      head: git(['rev-parse', 'HEAD']),
      dirtyEntries: activity.length,
    },
    task: {
      id: currentTaskId || 'não identificada',
      slug: field(activeBlock, 'slug'),
      roadmap: field(taskMarkdown, 'roadmap'),
      status: field(activeBlock, 'status') || 'in_progress',
      goal: field(activeBlock, 'goal'),
      nextAction,
      currentReview: reviews.currentTaskReview,
    },
    reviewProgress: reviews,
    validations,
    recentActivity,
    boundaries: [
      'PostgreSQL descartável no Docker Desktop é o único banco permitido.',
      'Sem Supabase, VPS, produção, dados ou credenciais reais.',
      'Aprovações são limitadas a cada fatia; H-DATA-003/H-DB-003 não estão globalmente aprovados.',
    ],
    refreshMinutes: 20,
  };
}

const page = `<!doctype html>
<html lang="pt-BR">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>WACRM — andamento PostgreSQL</title>
  <style>
    :root{color-scheme:dark;--bg:#08111f;--panel:#111d2f;--border:#263a57;--text:#e8eef8;--muted:#9badc7;--blue:#69aafc;--green:#45cfaa;--amber:#ffc66e;--red:#ff8282}
    *{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--text);font:15px/1.5 system-ui,Segoe UI,sans-serif}
    main{max-width:1160px;margin:auto;padding:28px 22px 48px}header{display:flex;align-items:center;justify-content:space-between;gap:16px;margin-bottom:22px}
    h1{font-size:25px;margin:0}h2{font-size:20px;margin:28px 0 12px}.muted{color:var(--muted)}
    .badge{border:1px solid var(--border);border-radius:99px;padding:6px 12px;color:var(--green);white-space:nowrap}
    .grid{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:12px}.card,.section{background:var(--panel);border:1px solid var(--border);border-radius:12px;padding:18px}
    .label{font-size:12px;color:var(--muted);text-transform:uppercase;letter-spacing:.06em}.value{font-size:18px;font-weight:650;margin-top:7px;overflow-wrap:anywhere}
    .section{margin-top:14px}.progress{height:10px;background:#29364a;border-radius:10px;overflow:hidden;margin-top:12px}.bar{height:100%;background:var(--green);width:0;transition:width .3s}
    table{width:100%;border-collapse:collapse}th,td{text-align:left;padding:10px 8px;border-bottom:1px solid var(--border);vertical-align:top}th{color:var(--muted);font-weight:600}
    ul{margin:8px 0 0;padding-left:21px}li{margin:7px 0;overflow-wrap:anywhere}.pass{color:var(--green)}.pending{color:var(--amber)}.fail{color:var(--red)}
    .actions{display:flex;align-items:center;gap:12px}button{background:#1e3554;color:var(--text);border:1px solid var(--border);border-radius:8px;padding:8px 12px;cursor:pointer}button:hover{background:#29476d}
    code{font-size:12px;color:#b9d4ff;overflow-wrap:anywhere}.foot{margin-top:18px;font-size:12px;color:var(--muted)}
    @media(max-width:780px){.grid{grid-template-columns:repeat(2,minmax(0,1fr))}header{align-items:flex-start;flex-direction:column}}
    @media(max-width:480px){.grid{grid-template-columns:1fr}main{padding:18px 12px}}
  </style>
</head>
<body>
  <main>
    <header>
      <div><div class="label">Painel local de execução</div><h1>WACRM · migração PostgreSQL</h1></div>
      <div class="actions"><span class="badge">● ATUALIZAÇÃO AUTOMÁTICA · 20 MIN</span><button id="refresh">Atualizar agora</button></div>
    </header>
    <section class="grid" id="summary"></section>
    <section class="section">
      <div class="label">Revisões independentes GPT-6 Luna · decisões mais recentes por task</div>
      <div class="value" id="review-count">—</div>
      <div class="muted">Conta a última revisão registrada por task. O estado concluída/em andamento é exibido separadamente; revisão de fatia não aprova a task ou a migração inteira.</div>
      <div class="progress"><div class="bar" id="review-bar"></div></div>
    </section>
    <h2>Tarefa ativa</h2><section class="section" id="task"></section>
    <h2>Testes e validações</h2><section class="section" id="validations"></section>
    <h2>Limites e bloqueios</h2><section class="section" id="boundaries"></section>
    <h2>Atividade recente</h2><section class="section" id="activity"></section>
    <div class="foot">Leitura do repositório, disponível somente neste computador. Atualizado: <span id="checked-at">—</span> · próxima atualização em até 20 min.</div>
  </main>
  <script>
    let initialStatus = __INITIAL_STATUS__;
    const el = (id) => document.getElementById(id);
    const safe = (value) => String(value ?? '—');
    const date = (value) => value ? new Intl.DateTimeFormat('pt-BR',{timeZone:'America/Sao_Paulo',dateStyle:'short',timeStyle:'medium'}).format(new Date(value)) : '—';
    const taskStatusLabel = (value) => ({in_progress:'Em andamento',complete:'Concluída',completed:'Concluída',blocked:'Bloqueada',paused:'Pausada'}[value] ?? 'Não informado');
    const reviewLabel = (value) => ({APPROVE:'Aprovada',REMEDIATION_REQUIRED:'Correções necessárias',pendente:'Pendente'}[value] ?? 'Não registrada');
    const resultLabel = (value) => ({PASS:'Passou',APPROVE:'Aprovada',FAIL:'Falhou','remediação requerida':'Correções necessárias'}[value] ?? 'Evidência registrada');
    function evidenceLabel(name) {
      if (/review-independent/i.test(name)) return 'Revisão independente GPT-6 Luna';
      if (/review-internal/i.test(name)) return 'Revisão interna';
      if (/focused/i.test(name)) return 'Testes focados da fatia';
      if (/postgres/i.test(name)) return 'Validação PostgreSQL descartável';
      if (/remediation/i.test(name)) return 'Registro da remediação';
      return 'Registro de validação';
    }
    function activityLabel(file) {
      if (/review-independent/i.test(file)) return 'Revisão independente registrada';
      if (/review-internal/i.test(file)) return 'Revisão interna registrada';
      if (/task\.md/i.test(file)) return 'Task atualizada';
      if (/validation/i.test(file)) return 'Validação registrada';
      return file.split(/[\\/]/).pop();
    }
    function renderList(id, rows, empty) {
      const target = el(id); target.replaceChildren();
      if (!rows.length) { target.textContent = empty; return; }
      const ul = document.createElement('ul');
      for (const row of rows) { const li = document.createElement('li'); li.textContent = row; ul.append(li); }
      target.append(ul);
    }
    async function refresh() {
      try {
        let data = initialStatus;
        let updateFailed = false;
        const response = await fetch('/api/status', {cache:'no-store'}).catch(() => null);
        if (response?.ok) {
          data = await response.json();
          initialStatus = data;
        } else {
          updateFailed = true;
        }
        if (!data) throw new Error('Status inicial indisponível');
        const cards = [
          ['Tarefa ativa', data.task.id],
          ['Estado', taskStatusLabel(data.task.status)],
          ['Ramo / versão do código', data.git.branch + ' · ' + data.git.head.slice(0,12)],
          ['Árvore local', data.git.dirtyEntries + ' entradas alteradas'],
        ];
        el('summary').replaceChildren(...cards.map(([label,value])=>{const card=document.createElement('div');card.className='card';const title=document.createElement('div');title.className='label';title.textContent=label;const val=document.createElement('div');val.className='value';val.textContent=safe(value);card.append(title,val);return card;}));
        const total = data.reviewProgress.roadmapTasks;
        const reviewed = data.reviewProgress.reviewedTasks;
        const approved = data.reviewProgress.latestSliceApproved;
        const percentage = total ? (approved / total * 100).toFixed(1) : '0.0';
        el('review-count').textContent = approved + ' / ' + total + ' tarefas H-DATA-003 com todos os pareceres registrados aprovados (' + percentage + '%); ' + reviewed + ' / ' + total + ' com revisão registrada; ' + data.reviewProgress.completedTasksApproved + ' tarefas concluídas e aprovadas';
        el('review-bar').style.width = percentage + '%';
        el('task').replaceChildren();
        const goal = document.createElement('p'); goal.textContent = data.task.goal || 'Meta não encontrada';
        const next = document.createElement('p'); next.innerHTML = '<strong>Próxima ação:</strong> '; next.append(document.createTextNode(data.task.nextAction || 'não registrada'));
        const review = document.createElement('p'); review.innerHTML = '<strong>Estado agregado da revisão desta task:</strong> '; const reviewSpan=document.createElement('span');reviewSpan.className=data.task.currentReview==='APPROVE'?'pass':data.task.currentReview==='REMEDIATION_REQUIRED'?'fail':'pending';reviewSpan.textContent=reviewLabel(data.task.currentReview);review.append(reviewSpan);
        el('task').append(goal,next,review);
        const table=document.createElement('table');const head=document.createElement('tr');for(const text of ['Evidência','Resultado','Atualizada em']){const th=document.createElement('th');th.textContent=text;head.append(th);}const thead=document.createElement('thead');thead.append(head);table.append(thead);const tbody=document.createElement('tbody');
        for(const item of data.validations){const row=document.createElement('tr');const evidence=document.createElement('td');evidence.textContent=evidenceLabel(item.name);evidence.title=item.name;row.append(evidence);const result=document.createElement('td');result.textContent=resultLabel(item.result);result.className=item.result==='PASS'||item.result==='APPROVE'?'pass':item.result==='FAIL'?'fail':'pending';row.append(result);const updated=document.createElement('td');updated.textContent=date(item.updatedAt);row.append(updated);tbody.append(row);}table.append(tbody);el('validations').replaceChildren(...(data.validations.length?[table]:[document.createTextNode('Ainda não há registros de validação nesta tarefa.') ]));
        renderList('boundaries', data.boundaries, 'Nenhum limite registrado.');
        renderList('activity', data.recentActivity.map(item=>activityLabel(item.file)+' · '+date(item.updatedAt)), 'Sem atividade recente registrada.');
        el('checked-at').textContent = updateFailed
          ? 'Falha ao atualizar; exibindo o último estado recebido.'
          : date(data.checkedAt);
      } catch (error) {
        console.error('Falha ao atualizar painel:', error);
        el('checked-at').textContent = 'Não foi possível atualizar o painel. Tente novamente em instantes.';
      }
    }
    el('refresh').addEventListener('click', refresh);
    refresh();
    setInterval(refresh, 20 * 60 * 1000);
  </script>
</body>
</html>`;

async function refreshAndPersist() {
  const status = await collectStatus();
  await writeFile(statusPath, `${JSON.stringify(status, null, 2)}\n`, 'utf8');
  return status;
}

const server = createServer(async (request, response) => {
  response.setHeader('Cache-Control', 'no-store');
  try {
    const port = server.address()?.port;
    if (!isAllowedDashboardHost(request.headers.host, port)) {
      response.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8' });
      response.end('Host não permitido');
      return;
    }

    if (request.method === 'GET' && request.url === '/dashboard.html') {
      const status = await refreshAndPersist();
      const bootstrap = JSON.stringify(status).replaceAll('<', '\\u003c');
      response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      response.end(renderDashboardPage(page, bootstrap));
      return;
    }

    if (request.method === 'GET' && request.url === '/api/status') {
      const status = await refreshAndPersist();
      response.writeHead(200, {
        'Content-Type': 'application/json; charset=utf-8',
      });
      response.end(JSON.stringify(status));
      return;
    }

    response.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    response.end('Não encontrado');
  } catch (error) {
    console.error('Falha ao processar requisição do painel:', error.message);
    if (response.headersSent) {
      response.destroy();
      return;
    }
    response.writeHead(500, {
      'Content-Type': 'application/json; charset=utf-8',
    });
    response.end(JSON.stringify({ error: 'Falha ao atualizar o painel' }));
  }
});

async function listen(port) {
  return new Promise((resolveListen, rejectListen) => {
    const onError = (error) => {
      server.off('listening', onListening);
      rejectListen(error);
    };
    const onListening = () => {
      server.off('error', onError);
      resolveListen(server.address().port);
    };
    server.once('error', onError);
    server.once('listening', onListening);
    server.listen(port, '127.0.0.1');
  });
}

async function start() {
  await mkdir(runtimeRoot, { recursive: true });
  let port = Number(process.env.WACRM_DASHBOARD_PORT || 49212);
  if (!Number.isInteger(port) || port < 0 || port > 65535) port = 49212;
  let activePort;
  for (let attempt = 0; attempt < 20; attempt += 1) {
    try {
      activePort = await listen(port === 0 ? 0 : port + attempt);
      break;
    } catch (error) {
      if (error.code !== 'EADDRINUSE') throw error;
    }
  }
  if (activePort === undefined)
    throw new Error('Nenhuma porta local disponível para o painel');

  const info = {
    pid: process.pid,
    url: `http://127.0.0.1:${activePort}/dashboard.html`,
    refreshMinutes: 20,
    runtimePath: runtimeRoot,
  };
  await writeFile(serverInfoPath, `${JSON.stringify(info, null, 2)}\n`, 'utf8');
  await refreshAndPersist();
  console.log(`Painel disponível em: ${info.url}`);

  const interval = setInterval(() => {
    refreshAndPersist().catch((error) =>
      console.error('Falha ao atualizar painel:', error.message)
    );
  }, refreshMs);

  const stop = async () => {
    clearInterval(interval);
    await new Promise((resolveClose) => server.close(resolveClose));
    try {
      await readFile(serverInfoPath, 'utf8');
      await writeFile(
        serverInfoPath,
        `${JSON.stringify({ ...info, stoppedAt: new Date().toISOString() }, null, 2)}\n`,
        'utf8'
      );
    } catch {}
    process.exit(0);
  };
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);
}

start().catch((error) => {
  console.error('Falha ao iniciar painel:', error);
  process.exitCode = 1;
});
