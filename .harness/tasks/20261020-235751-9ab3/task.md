# Tarefa — leitura de diagnóstico do registro WhatsApp

- id: `20261020-235751-9ab3`
- type: `migration`
- slug: `postgres-whatsapp-registration-diagnostics-route`
- status: `complete`
- roadmap: H-DATA-003, phase 03

## Meta

Migrar somente a leitura de dados de `GET /api/whatsapp/config/verify-registration` para o repositório PostgreSQL por conta, preservando o contrato diagnóstico, a sessão verificada e a sequência das verificações Meta.

## Contexto

A fatia anterior `POST /api/whatsapp/config` recebeu re-review independente GPT-6 Luna `APPROVE`, zero achados/ressalvas para as correções documentais/evidenciais. Registro: `.harness/tasks/20261020-212612-34b1/review-gpt6-luna-final-20261020.md`. O repositório PostgreSQL WhatsApp já existia; este endpoint ainda lia `profiles` e `whatsapp_config` com `.from()`.

## Escopo

- Adicionar projeção PostgreSQL mínima, parametrizada e limitada à conta verificada para os campos do diagnóstico.
- Migrar somente a leitura de dados desta rota; manter Auth verificada existente, payload/status, tratamento de token ilegível e sequência Meta.
- Cobrir rota, repositório, membros sem configuração e isolamento de conta. Meta é mockada em testes.
- Provar a leitura sob PostgreSQL 16 sintético e descartável no Docker Desktop.

## Fora de escopo

- Supabase local/remoto, banco/service role Supabase ou serviços externos. A fronteira de Auth existente é mantida; testes mockam a sessão e não conectam a serviço Supabase.
- Chamadas Meta reais, credenciais/dados/chips reais, outras rotas, Auth replacement, schema/RLS/grants permanentes, Storage, Realtime, tráfego, VPS, produção, commit, push ou deploy.
- Aprovação global de H-DATA-003 ou H-DB-003. O forced-RLS usado na prova é fixture descartável e não comprova as migrations atuais.

## Implementação

- Adicionado `getRegistrationDiagnostics()` ao repositório existente. Exige conta derivada da sessão verificada, seta identidade RLS local à transação, seleciona somente telefone, WABA, token criptografado, registros de inscrição e último erro; limita a duas linhas e falha em duplicidade ou campos malformados.
- Migrada a leitura da rota para o novo método. A rota não usa `.from()` para dados; mantém 401, respostas diagnósticas 200, decrypt e verificações Meta. Erro de banco retorna 500 genérico; ausência de associação preserva o diagnóstico sem conta.
- Testes confirmam contrato, ausência de consulta Supabase para dados, identidade/account scope, membro viewer, sem configuração, token ilegível, falhas Meta e erro de banco sem vazamento.

## Validações

- TDD RED registrado em `tdd-red-20261020.log`: 2 arquivos falharam, 11 testes falharam e 1 passou antes da implementação.
- `npx vitest run` nos sete testes das rotas WhatsApp config/react e repositório: **7 arquivos, 69/69 testes aprovados** — `validation-related-tests-final2.log`.
- `npm run typecheck`: passou — `validation-typecheck-final2.log`.
- ESLint direcionado com `--max-warnings=0`: passou, zero avisos — `validation-eslint-final2.log`.
- Prettier check nos arquivos alterados da fatia e painel: passou — `validation-prettier-final2.log`.
- Checagem final do painel: `node --check .harness/dashboard-server.mjs` e `npx prettier --check .harness/dashboard-server.mjs` passaram; servidor local reiniciado após confirmar a identidade do processo e a posse da porta. `GET /api/status` e `GET /dashboard.html` retornaram 200, com rótulos visíveis em português — `validation-dashboard-final.log`.
- Integração PostgreSQL 16 no Docker Desktop: passou com `--network none`, dados sintéticos, mounts somente leitura e limpeza sem recursos residuais. Exercitou leitura owner/viewer, conta vazia, forced RLS e probes existentes — `validation-postgres-whatsapp-config-post-456ca042feca.log`. Fixture não comprova políticas permanentes das migrations.
- `git diff --check`: exit 0 — `validation-diff-check.log`; Git mostrou avisos LF→CRLF em arquivos já alterados no worktree.
- A primeira checagem TS e a primeira ESLint encontraram somente tipos/nomes não usados no teste novo; corrigidos e substituídos pelas execuções finais acima.

## Revisão independente

GPT-6 Luna read-only retornou `APPROVE`, zero achados e zero ressalvas em `.harness/tasks/20261020-235751-9ab3/handoffs/reviewer.md`. Aprovação limitada à migração de `GET /api/whatsapp/config/verify-registration`; H-DATA-003/H-DB-003 permanecem sem aprovação global.

## Próxima ação

Prosseguir com `20261021-003953-b27d`, migração limitada da persistência local de `DELETE /api/whatsapp/templates/[id]`. Parar às 09:00 BRT de 21/10/2026 e registrar o ponto exato de retomada.

## Resultado

Leitura diagnóstica da rota migrou para o repositório PostgreSQL por conta, mantendo a sessão Auth existente, o contrato, os diagnósticos Meta e as falhas genéricas de banco. Testes relacionados, TypeScript, ESLint, Prettier, evidência PostgreSQL descartável e revisão independente passaram.

## Risco remanescente

Auth e Meta reais, migrations/RLS/grants atuais, dados/chips reais, tráfego e produção não foram validados. Evidência PostgreSQL é sintética e não representa produção. A aprovação cobre somente esta rota.

## Acompanhamento

H-DATA-003 continua em andamento. Próxima fatia registrada em `.harness/tasks/20261021-003953-b27d/task.md`.
