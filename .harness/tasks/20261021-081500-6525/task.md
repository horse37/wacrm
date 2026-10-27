# Task — Leitura PostgreSQL do alvo do stream de eventos Zap Lead

- **ID:** 20261021-081500-6525
- **Tipo:** migration
- **Slug:** postgres-zap-lead-event-stream-target-read
- **Estado:** complete; revisão interna e independente GPT-6 Luna APPROVE, zero achados e zero ressalvas, limitadas à fatia.
- **Plano:** H-DATA-003, fase 03

## Objetivo

Migrar somente a leitura da configuração da integração e do cursor SSE usada para preparar `GET /api/zap-lead/events/stream` para um repositório PostgreSQL server-only.

## Contexto

A fatia `20261021-072715-1f87` migrou e recebeu revisão interna e independente GPT-6 Luna `APPROVE`, zero achados e zero ressalvas, limitada ao `GET /api/zap-lead/registration`. O helper `getZapLeadEventStreamTargetForCurrentAccount` ainda consulta PostgREST para ler `zap_lead_integrations` e `zap_lead_integration_state.

## Escopo

- Trocar apenas essas leituras no helper por SQL parametrizado em repositório server-only.
- Manter `requireRole('admin')`, validação/descriptografia da credencial, cliente da agência e protocolo SSE sem alteração semântica.
- Escopo por `account_id` e vínculo do cursor com a chave atual; claim de identidade transaction-local; resultados ausentes preservam comportamento atual.
- Provar conta/RLS/identidade com PostgreSQL 16 descartável no Docker Desktop; não abrir stream nem fazer requisição externa.
- TDD RED/GREEN, validações focadas, documentação da evidência, revisão interna e independente GPT-6 Luna read-only até `APPROVE`, zero achados e zero ressalvas.

## Fora do escopo

- Abrir SSE ou tráfego para serviço externo; outros métodos/rotas; Auth; migrations/policies/grants permanentes; Supabase local/remoto; VPS/produção; dados/credenciais reais.
- H-DB-003/H-DATA-003 globais, Realtime, tráfego ou aprovação da migração inteira.
- Commit, push ou deploy.

## Validação

Vitest focado, PostgreSQL 16 sintético em Docker descartável com RLS forçada, TypeScript, ESLint focado, Prettier, sintaxe dos scripts pertinentes e `git diff --check`. Registrar limites e próxima ação em `task.md`, `handoffs/implementer.md`, `.harness/current-task.md` e `HANDOFF-CONTEXT.md.

## Implementação concluída

- Repositório server-only lê somente os campos necessários da integração por `account_id`; cursor é consultado separadamente por `account_id` e `integration_key_id`, ambos parametrizados.
- Cada leitura valida UUIDs e configura `request.jwt.claim.sub` transaction-local. A leitura de integração valida que a linha devolvida corresponde à conta autenticada.
- `getZapLeadEventStreamTargetForCurrentAccount` mantém `requireRole` de admin, descriptografia/parsing, cliente externo e mensagens genéricas; não consulta `account.supabase`. Rota/protocolo SSE não foram alterados.
- Integração ausente retorna null sem consultar cursor. Nenhuma requisição externa ou SSE foi aberto.

## Validações

- TDD RED do repositório: import do módulo ausente falhou antes da implementação (`validation-tdd-red.log`). TDD RED do helper falhou na leitura PostgREST antiga (`validation-tdd-helper-red.log`).
- Vitest focado: 21/21 em três arquivos; repositório, credentials e rota SSE com mocks (`validation-vitest-final.log`).
- PostgreSQL 16 em Docker descartável: SUCCESS; contas A/B, owner/viewer, chave/cursor isolados, RLS forçada, runtime sem `BYPASSRLS` e limpeza da identidade transaction-local (`validation-postgres-docker.log`). Fixture e repositório montados somente leitura; dados em tmpfs; rede Docker internal, sem saída/publicação de porta; nenhum serviço externo consultado. Containers e rede removidos.
- TypeScript passou (`validation-typecheck-final.log`); ESLint focado com `--max-warnings=0`, zero avisos (`validation-eslint-final.log`).
- Prettier passou nos arquivos alterados da fatia (`validation-prettier-final.log`). `src/app/api/zap-lead/events/stream/route.test.ts` foi executado, permaneceu inalterado e ficou fora do check de formato.
- Sintaxe Node dos dois scripts de validação passou (`validation-node-syntax.log`); `git diff --check` passou (`validation-diff-check.log`).

## Revisões

- Revisão interna read-only: `APPROVE`, zero achados/ressalvas; registro `review-internal-20261021.md`.
- Revisão independente GPT-6 Luna read-only: APPROVE, zero achados/ressalvas; registro review-independent-20261021.md.

## Próxima ação
Fatia concluída. Próxima: task 20261021-090800-c1f7, leitura PostgreSQL da credencial de webhook Zap Lead por keyId. Preservar limites de RLS e provar acesso em PostgreSQL descartável no Docker Desktop; H-DATA-003/H-DB-003 continuam sem aprovação global. Parar às 09:00 BRT de 2026-10-22.