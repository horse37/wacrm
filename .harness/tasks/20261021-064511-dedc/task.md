# Task — Pausa PostgreSQL de execução Flow após envio WhatsApp

- **ID:** `20261021-064511-dedc`
- **Tipo:** migration
- **Slug:** `postgres-whatsapp-send-flow-run-pause`
- **Estado:** complete
- **Plano:** H-DATA-003, fase 03
- roadmap: H-DATA-003, phase 03

## Objetivo

Migrar somente a pausa best-effort de `public.flow_runs` após envio WhatsApp aceito em `POST /api/whatsapp/send` para repositório PostgreSQL server-only.

## Contexto

A rota ainda atualiza `flow_runs` via PostgREST após sucesso do provedor e da atualização de conversa. Preservar `status = 'paused_by_agent'`, `ended_at`, `end_reason = 'agent_replied'`, filtros por conta/contato/status ativo, posição na sequência e semântica best-effort: falha ou ausência de linha não altera resposta de sucesso. A atualização de conversa foi aprovada separadamente em `20261021-060400-c97f`.

## Escopo

- Usar UUIDs validados, SQL parametrizado, identidade transaction-local e escopo por `account_id`, `contact_id` e `status = 'active'`.
- Testar atualização, ausência de execução ativa, isolamento por conta/contato, falha após envio aceito e ordem pós-aceitação.
- Provar PostgreSQL 16 descartável no Docker Desktop, RLS forçada, permissões e limpeza da identidade.

## Fora do escopo

Outras operações de `POST /api/whatsapp/send`, conversas, mensagens, contatos, CRUD/listagem de Flow, `flow_run_events`, Auth/sessão, schema/policies/grants permanentes, Supabase, Meta/WhatsApp real, VPS, produção, tráfego, dados/credenciais reais, Storage, Realtime, commit, push e deploy. Não declarar aprovação global de H-DATA-003 ou H-DB-003.

## Validação

TDD RED; Vitest focado; TypeScript; ESLint focado com `--max-warnings=0`; Prettier; sintaxe pertinente; integração PostgreSQL 16 descartável; `git diff --check`; revisão interna e revisão independente GPT-6 Luna read-only. Corrigir somente achados desta fatia até `APPROVE`, zero achados e zero ressalvas.

## Resultados da implementação

- TDD RED registrado em `tdd-red-flow-run-pause.log`.
- Vitest focado final: 29/29 (`validation-focused-vitest-final.log`), incluindo transição, falha best-effort, ordem após aceite e ausência de pausa quando provedor rejeita.
- TypeScript, ESLint `--max-warnings=0`, Prettier, sintaxe Node, sintaxe PowerShell e `git diff --check` passaram; logs em `validation-*.log`.
- PostgreSQL 16 descartável: owner autorizado; viewer, outra conta, outro contato, status não ativo, execução já pausada e UUID inválido não alteram registro indevido; status/motivo/timestamp persistidos; RLS forçada, identidade transaction-local limpa e containers removidos. Evidência: `validation-postgres-flow-run-pause-06f1c2ad10.log`.
- Revisão interna read-only e revisão independente GPT-6 Luna read-only: APPROVE, zero achados e zero ressalvas após corrigir inconsistência documental. Relatório: review-independent-20261021.md. Aprovação limitada à pausa pós-envio de flow_runs; task H-DATA-003/H-DB-003 não recebeu aprovação global.

## Limite de autorização

As migrations atuais não definem política de `UPDATE` para `flow_runs`; a fixture descartável define policy/grant temporários e account-scoped apenas para a prova. Nenhuma policy ou grant permanente foi alterada. A matriz de grants/policies do runtime permanece no trabalho H-DB-003; este parecer não prova implantação com papel runtime real.

## Limites

Preservar alterações locais existentes. Sem reset, restore, clean, rebase, troca de branch, Supabase, VPS, produção, dados/credenciais reais, commit, push ou deploy. PostgreSQL descartável no Docker Desktop é o único banco autorizado. Parar às 09:00 BRT de 2026-10-22.

## Próxima ação
Fatia aprovada e documentada; próxima task estreita: GET /api/zap-lead/registration, leitura da configuração em PostgreSQL. Task H-DATA-003 continua em andamento.