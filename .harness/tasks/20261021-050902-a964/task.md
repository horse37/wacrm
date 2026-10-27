# Task — Correção PostgreSQL do telefone do contato no envio WhatsApp

- id: `20261021-050902-a964`
- type: `migration`
- slug: `postgres-whatsapp-send-contact-phone-update`
- status: `in_progress`
- roadmap: H-DATA-003, phase 03
- review: internal and independent GPT-6 Luna read-only `APPROVE`, zero findings/caveats; independent record `review-independent-20261021.md`. Approval limited to this slice.

## Goal

Migrar somente a atualização automática do telefone do contato após envio WhatsApp bem-sucedido para PostgreSQL, mantendo envio e resposta HTTP existentes.

## Context

`POST /api/whatsapp/send` já consulta conversa/contato e configuração por repositórios PostgreSQL. A fatia anterior, `20261021-044247-b6ae`, recebeu revisões interna e independente `APPROVE`, sem achados nem ressalvas, limitada ao upgrade assíncrono do token legado. Hoje, se uma variante normalizada do telefone é aceita, a rota atualiza `contacts.phone` diretamente pelo cliente PostgREST.

## In scope

- Adicionar método server-only de repositório para corrigir `contacts.phone` por `contactId` e conta verificada.
- Definir identidade somente dentro da transação e manter a política RLS existente; UPDATE parametrizado e tenant-scoped.
- Trocar somente a escrita de correção de telefone na rota.
- Preservar comportamento best-effort: falha na persistência não deve desfazer envio já aceito nem expor detalhes do banco.
- Testes de repositório e rota, incluindo recusa/isolamento e ausência de escrita PostgREST nesta fatia.
- Prova sintética em PostgreSQL descartável do Docker Desktop para owner, viewer e outra conta.

## Out of scope

Inserção de mensagens, atualização da conversa, pausa de `flow_runs`, Auth/sessão, outras leituras/escritas, chamadas Meta/WhatsApp reais, schema/policies/grants permanentes, Supabase local/remoto, Storage, Realtime, VPS, produção, tráfego, dados/credenciais reais, H-DB-003 e aprovação global H-DATA-003.

## Validation

- Testes Vitest focados da rota e do repositório; primeiro executar caso RED para a mudança.
- TypeScript, ESLint e Prettier somente nos arquivos tocados; `git diff --check`.
- Integração com PostgreSQL 16 descartável em Docker Desktop, sem rede/portas/dados reais, cobrindo owner, viewer, conta cruzada e limpeza da identidade transacional.
- Revisões interna e independente GPT-6 Luna read-only; resolver achados desta fatia e repetir até `APPROVE`, zero achados e zero ressalvas.

## Implementation

- `createPostgresWhatsAppSendConversationRepository` now exposes `updateContactPhone`, which validates the contact UUID and applies a parameterized `UPDATE` scoped by contact ID and verified account. It sets `auth.uid()` transaction-locally and returns false when RLS updates no row.
- `POST /api/whatsapp/send` now calls this method only after Meta accepts a phone variant. Persistence errors are sanitized and logged; the already accepted send remains successful.
- No schema, policy or permanent grant changed. Message insert, conversation update and flow-run pause remain PostgREST and out of scope.

## Validation results — 2026-10-21 BRT

- TDD RED: the new route and repository behavior tests failed as expected before production changes; log `tdd-red-contact-phone-repository.log`.
- Focused Vitest passed 20/20: route and repository; `validation-focused-vitest-final.log`.
- PostgreSQL 16 disposable Docker Desktop integration passed: `NOBYPASSRLS`, owner update, viewer denial, cross-account isolation, and transaction-local identity cleanup. Final evidence: `validation-postgres-contact-phone-e1144dc919.log`; no external network, exposed ports or residual containers.
- `npx tsc --noEmit` passed; focused ESLint passed with zero warnings; Prettier passed for touched TypeScript/MJS; Node and PowerShell syntax checks passed; `git diff --check` passed. Logs: `validation-typescript.log`, `validation-eslint.log`, `validation-prettier.log`, `validation-prettier-route-current.log`, `validation-syntax.log`, `validation-diff-check.log`.
- No Supabase, Meta/WhatsApp real, VPS, production, real traffic, data or credentials accessed.

## Next action

Internal and independent GPT-6 Luna read-only reviews returned `APPROVE`, zero findings and zero caveats; records: `review-internal-20261021.md` and `review-independent-20261021.md`. This slice is complete. Next narrow slice: migrate only the sent-message insert in `POST /api/whatsapp/send` to the server-only PostgreSQL repository, preserving current response and failure semantics. Keep conversation update and flow-run pause separate.
