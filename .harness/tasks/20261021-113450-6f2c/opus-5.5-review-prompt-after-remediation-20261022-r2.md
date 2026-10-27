# Independent GPT-6 Luna review prompt — full WACRM working tree

Faça revisão de código independente, somente leitura e completa do working tree atual em `C:\Sistemas\wacrm`, comparando-o ao commit base `7db4abf47dbc94a732f3ab67ac4d53ba660c9a2c`.

## Confirmação e cobertura

1. Confirme branch `main`, HEAD esperado e inventário atualizado de todas as alterações rastreadas e não rastreadas (`git status --short --untracked-files=all`). O working tree contém trabalho anterior a 2026-10-16 e continua local, sem commit.
2. Leia `AGENTS.md`, `HANDOFF-CONTEXT.md`, `.harness/current-task.md`, a task ativa e seus handoffs/reviews. Leia o parecer original completo em `.harness/tasks/20261021-113450-6f2c/review-opus-working-tree-20261022.md`.
3. Revise todas as alterações de código, migrations/fixtures, testes, scripts de integração, contrato, documentação e artefatos Harness que possam alterar segurança, comportamento ou a alegação de validação. Não aprove com cobertura parcial; declare cada exclusão e limite.
4. A task `20261021-113450-6f2c` permanece `in_progress`. O parecer Opus integral anterior foi `REMEDIATION_REQUIRED`. As aprovações GPT-6 Luna abaixo são independentes e limitadas a cada delta; não substituem esta revisão global.

## Achados anteriores e remediações que precisam ser reavaliadas

1. **Ordem e agregação de reviews** — corrigido em `.harness/dashboard-review-progress.mjs`; data/hora prevalece sobre fase/rodada, escopo amplo de task/worktree não é aprovado por reviews de fatia e os casos estão cobertos por regressões. Evidência: `.harness/tasks/20261021-113450-6f2c/validation-review-order-remediation-20261022.log`. Revisão limitada aprovada: `review-opus-f1-independent-20261022-r1.md`.
2. **Role PostgreSQL que ignora RLS** — pool e migration falham fechado para roles/memberships privilegiados ou proprietários das relações protegidas; runner grava evidência no diretório da task atual. Reavalie `src/lib/db/postgres-pool.ts`, migration 028 e prova negativa/paridade. Evidência descartável: `validation-postgres-runtime-role-guard-f07305187b.log` e `validation-postgres-zap-lead-runtime-migration-e35b5694d4.log`. Revisão limitada aprovada: `review-opus-f2-independent-20261022-r2.md`.
3. **Policy/grants de runtime apenas em fixture** — migration versionada 028 e prova que aplica migrations reais 001–028, cobre isolamento, grants/RLS e leitores; confira se fixture histórica não é apresentada como paridade. Evidência PostgreSQL 16 descartável: `validation-postgres-zap-lead-runtime-migration-e35b5694d4.log`. Revisão limitada aprovada: `review-opus-f3-luna-independent-20261022-r3.md`.
4. **Flag de webhook sugeria caminho PostgreSQL completo** — renomeada para `WACRM_ZAP_LEAD_WEBHOOK_POSTGRES_CREDENTIAL_LOOKUP_ENABLED`; escrita RPC existente está delimitada e a flag antiga falha fechado. Revise rota e testes. Evidência: `validation-opus-f4-webhook-flag-20261022.log`. Revisão limitada aprovada: `review-opus-f4-independent-20261022-r1.md`.
5. **Contrato/status do resgate de convite** — mapa estável por erro mantém status/mensagens e sanitização; cobertura usa `withTransaction` real e pool simulado, incluindo SQLSTATE, commit/rollback e liberação. Evidência: `validation-opus-f5-invitation-contract-20261022.log`. Revisão limitada aprovada round 2: `review-opus-f5-independent-20261022-r2.md`.
6. **Parser poderia indicar PASS apesar de falhas** — parser detecta `AssertionError` e `Exit status` não zero antes de evidência positiva. Verifique os casos mistos e precedência do parser. Evidência: `validation-opus-f6-dashboard-validation-parser-20261022.log`. Revisão limitada aprovada round 3: `review-opus-f6-independent-20261022-r3.md`.

## Correção adicional descoberta na conferência final

O endpoint do painel retornava `validations: []`: `.harness/dashboard-server.mjs` usava `classifyReview` sem importá-la, e o `catch` ocultava o erro. Import e regressão HTTP foram corrigidos. O teste agora executa cópia isolada do servidor com task, validação e review sintéticos, sem dependência da task ativa nem dos dez registros mais recentes. Validação: `validation-dashboard-validation-list-20261022.log`. Review round 1 apontou acoplamento do teste; foi corrigido com fixture hermética. GPT-6 Luna round 2 aprovou somente este delta, zero achados/ressalvas: `review-dashboard-validation-list-independent-20261022-r2.md`. Reavalie implementação e teste; não trate `PASS`/`APPROVE` sintético do fixture como evidência de aprovação da task real.

## Reavaliação global requerida

- Reavalie os seis achados acima, todas as ressalvas do parecer anterior e a cobertura dos arquivos não revisados, incluindo identidade/role de conexão, membership/`SET ROLE`, RLS/grants, migrations versus fixtures, consultas parametrizadas, transações/rollback, `server-only`, limites de conta, contrato HTTP e classificação de reviews/validações.
- Confirme que docs, painel e logs separam decisões limitadas por fatia do veredito integral; task continua `in_progress` e H-DATA-003/H-DB-003 não têm aprovação global.
- Para cada achado, informe prioridade, arquivo e linha atuais, cenário reproduzível, impacto, evidência e menor correção. Diferencie defeito de código, ressalva de cobertura e dependência externa.

## Limites de segurança

Revisão somente leitura: não editar arquivos, não executar testes/builds, migrations, containers ou bancos, não fazer commit/push/deploy. Não acessar Supabase local/remoto, VPS, produção, APIs externas, tráfego real, dados ou credenciais reais. Não usar Auth, Storage, Realtime, Meta/WhatsApp ou tráfego de aplicação como evidência. PostgreSQL descartável no Docker Desktop é o único DB permitido no projeto; esta revisão não requer iniciar um banco.

## Resposta obrigatória

Comece com `Scope`, `Verdict`, `Findings` e `Caveats`. Use `APPROVE` somente após cobertura integral do working tree e zero achados e zero ressalvas. Qualquer cobertura incompleta, evidência ilegível ou item não avaliado exige `REMEDIATION_REQUIRED`. Cite caminhos e linhas verificadas. Aprovação vale apenas para o working tree e o escopo efetivamente revisados; não aprove a task Harness, H-DATA-003, H-DB-003 ou produção globalmente.
