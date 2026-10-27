# Task — Gravações PostgreSQL do heartbeat Zap Lead

- ID: 20261023-004958-ea9f
- Tipo: migration
- Slug: postgres-zap-lead-heartbeat-writes
- Status: complete para esta fatia (sem commit)
- Roadmap: H-DATA-003, fase 03

## Objetivo

Migrar somente recordZapLeadHealthSuccess, recordZapLeadHealthFailure e claimZapLeadHeartbeatAlert dos RPCs Supabase para um repositório PostgreSQL server-only, chamando as funções preexistentes da migration 026. Preservar resultados booleanos, proteção por geração da credencial, idempotência e erros genéricos.

## Escopo

- Migrar somente as três gravações usadas pelo fluxo de heartbeat.
- Manter inalterados o agendador, a consulta de alvos, a chamada externa de health, os schemas, migrations, gates, RLS, ownership e grants permanentes.
- Adicionar testes de contrato e prova de integração PostgreSQL descartável para sucesso/falha, chave obsoleta, estado de alerta e idempotência.
- Cobrir as assinaturas existentes: sucesso (account_id, key_id, checked_at), falha (account_id, key_id, error_code, failed_at), alerta (account_id, key_id, now).

## Validação

- Registrar TDD vermelho antes da implementação.
- Executar Vitest focado, TypeScript, ESLint focado com zero avisos, Prettier, sintaxe Node/PowerShell e git diff --check.
- Aplicar migrations 001–028 a PostgreSQL 16 descartável no Docker Desktop e validar comportamento com dados sintéticos e grants de teste temporários apenas nessa instância descartável.
- Não afirmar prontidão do usuário runtime nem aprovação H-DB-003 com base nessa prova.

## Fora do escopo e limites

Não chamar Supabase, Meta/WhatsApp ou endpoint externo real. Não alterar heartbeat de rede, credenciais/configuração, rota/gate, schema, migrations, função, RLS ou grants permanentes. Sem VPS, produção, tráfego/dados/credenciais reais, banco persistente, commit, push ou deploy. PostgreSQL descartável no Docker Desktop somente.

A task anterior 20261022-235737-7a9c recebeu aprovação independente GPT-6 Luna somente para o recibo SSE. O review integral Opus 5.5 r2 continua REMEDIATION_REQUIRED aguardando nova revisão do proprietário; H-DATA-003 e H-DB-003 não estão aprovados globalmente.

## Implementação concluída no working tree

- `src/lib/repositories/zap-lead-heartbeat.ts` chama as três funções existentes da migration 026 por SQL parametrizado, via `withTransaction`, com import `server-only` e mensagens de erro genéricas compatíveis.
- `src/lib/zap-lead/events.ts` delega somente as três gravações ao repositório PostgreSQL. Agendador, health HTTP, consulta de alvos e funções do banco ficaram fora da alteração.
- Testes unitários cobrem parâmetros, booleanos, falhas genéricas e resultados inválidos. Integração cobre chave obsoleta, sucesso e limpeza do estado anterior, supressão por sucesso recente, códigos de falha e claim único/idempotente do alerta.
- TDD vermelho registrado em `tdd-red-heartbeat-repository-20261023.log`.

## Resultado das validações

- Vitest focado: 17/17.
- `npx tsc --noEmit`: passou.
- ESLint focado: passou, zero avisos.
- Prettier focado: passou após formatar o script de integração.
- Sintaxe Node e parser PowerShell: passaram.
- PostgreSQL 16 descartável no Docker Desktop aplicou migrations 001–028 e passou nas asserções desta fatia. O banco usou `--network none`, volume `tmpfs`, montagem do repositório somente leitura, identidades sintéticas e grants temporários só nessa instância descartável; nenhum container residual. Evidência final: `validation-postgres-zap-lead-heartbeat-writes-1cb268598b.log`.
- A tentativa anterior `validation-postgres-zap-lead-heartbeat-writes-31574ba583.log` foi preservada, mas não é evidência final: a integração passou e o Vitest executado depois teve uma falha. A prova focada atual passou 17/17.
- `git diff --check`: passou; Git emitiu somente avisos LF/CRLF de arquivos já modificados.

## Revisão e limites

- Revisão interna e revisão independente GPT-6 Luna: `APPROVE`, zero achados e zero ressalvas, limitadas às três gravações. Registros: `review-internal.md` e `review-independent.md`.
- Esta fatia está tecnicamente concluída e aprovada. Nenhum commit foi criado; o código permanece no working tree conforme autorização vigente.
- O review integral Opus 5.5 r2 continua `REMEDIATION_REQUIRED` e aguardando novo parecer do proprietário. Esta task não aprova globalmente H-DATA-003, H-DB-003 nem o working tree.
- Sem Supabase, chamadas externas, VPS, produção, dados/credenciais reais ou banco persistente; sem commit, push ou deploy.
