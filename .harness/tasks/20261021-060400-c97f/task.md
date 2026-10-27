# Task — Atualização da conversa após envio WhatsApp

- **ID:** `20261021-060400-c97f`
- **Tipo:** migration
- **Slug:** `postgres-whatsapp-send-conversation-update`
- **Estado:** `in_progress`
- **Plano:** H-DATA-003, fase 03

## Objetivo

Migrar somente a atualização pós-envio de `public.conversations` em `POST /api/whatsapp/send` para repositório PostgreSQL server-only.

## Contexto e escopo

Preservar atualização de `last_message_text`, `last_message_at` e `updated_at`, a associação por conversa e conta verificada, a identidade transaction-local para RLS e a semântica best-effort atual: falha/ausência de linha nessa atualização não desfaz envio já aceito nem altera a resposta de sucesso. Usar UUIDs validados e SQL parametrizado.

Testar caminho feliz, valores persistidos, UUID inválido, conversa ausente/conta cruzada, falha PostgreSQL após envio aceito e ordem após aceitação do provedor. Provar autorização/negação e isolamento com PostgreSQL descartável no Docker Desktop, RLS forçada e limpeza da identidade.

## Fora do escopo

Inserção de `messages`, correção de `contacts.phone`, pausa de `flow_runs`, outras operações da rota, Auth/sessão, schema/policies/grants permanentes, Supabase, Meta/WhatsApp real, VPS, produção, tráfego, dados/credenciais reais, Storage, Realtime, commit, push e deploy.

## Validação

Registrar TDD RED. Rodar Vitest focado, TypeScript, ESLint focado sem novos avisos, Prettier, sintaxe pertinente, PostgreSQL 16 descartável no Docker Desktop e `git diff --check`. Depois do diff congelado, obter revisão interna e independente GPT-6 Luna read-only; corrigir somente achados desta fatia até `APPROVE`, zero achados e zero ressalvas.

## Evidências da implementação

- TDD RED: 4 falhas esperadas, 22 testes passaram (`tdd-red-conversation-update.log`).
- Vitest focado: 26/26 (`validation-focused-vitest-final.log`); repetido após remediação P2: 26/26.
- TypeScript, ESLint focado com `--max-warnings=0`, Prettier e `node --check` passaram; `validation-node-syntax.log` preenchido após a remediação.
- PostgreSQL 16 descartável no Docker Desktop, RLS forçada e sem containers residuais: proprietário permitido; viewer, outra conta, UUID inválido e UUID válido inexistente negados/sem alteração; valores persistidos e identidade transaction-local limpa. Evidência pós-remediação: `validation-postgres-conversation-update-f3e6019250.log`.
- Revisão interna inicial e re-review pós-remediação: sem achados na fatia.
- Revisão independente GPT-6 Luna inicial: REMEDIATION_REQUIRED por falta de prova PostgreSQL para conversa inexistente. Runner passou a testar UUID válido não semeado e retornar `false`; nova integração passou.
- Re-review independente GPT-6 Luna: `APPROVE`, zero achados e zero ressalvas. Confirmou que a fixture semeia apenas `conversationA`/`conversationB`, que `conversationMissing` não é semeada, que o runner exige `false` e que a integração final passou. Aprovação limitada a esta fatia; relatório no handoff do reviewer.

## Limites

Preservar mudanças locais existentes. Sem reset, restore, clean, rebase, troca de branch, Supabase, VPS, produção, dados/credenciais reais, commit, push ou deploy. Registrar ponto de retomada e parar às 09:00 BRT de 2026-10-22. Não declarar aprovação global de H-DATA-003 ou H-DB-003.
