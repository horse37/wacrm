# Task — Atualização PostgreSQL do token legado no envio WhatsApp

- id: 20261021-044247-b6ae
- type: migration
- slug: postgres-whatsapp-send-legacy-token-upgrade
- status: completed
- roadmap: H-DATA-003, phase 03
- review: internal and independent read-only GPT-6 Luna APPROVE, zero findings/caveats, limited to this slice

## Goal

Migrar somente a atualização assíncrona do token legado em POST /api/whatsapp/send para o repositório PostgreSQL existente, preservando o comportamento best-effort.

## Context

Leituras da configuração/template, conversa/contato e alvo de resposta já usam repositórios PostgreSQL nesta rota. A fatia anterior 20261021-040103-7c52 recebeu APPROVE interno e independente GPT-6 Luna, sem achados nem ressalvas, limitada ao lookup da configuração.

## In scope

- Operação server-only do repositório para atualizar access_token pelo configId e accountId da sessão verificada.
- Identidade transaction-local e RLS existente; UPDATE só altera a linha com ID e conta correspondentes.
- Trocar somente o write PostgREST do token legado na rota.
- Manter cifra GCM, atualização sem await, aviso seguro em falha e envio independente do resultado do upgrade.
- Provas sintéticas de owner autorizado, viewer bloqueado e isolamento cross-account.

## Out of scope

Contato, messages, conversations, flow_runs, Auth/sessão, chamadas Meta/WhatsApp, schema/policy/grants permanentes, Supabase real/local, Storage, Realtime, tráfego, dados/credenciais reais, VPS, produção, H-DB-003 e aprovação global H-DATA-003.

## Implementation

- Repository method upgradeLegacyToken usa requireAccount, configura auth.uid() apenas dentro da transação e executa UPDATE parametrizado por configId e accountId. Retorna true se RLS atualizou uma linha; false se a linha não é visível/atualizável.
- POST continua sem aguardar a operação. Rejeições são convertidas em mensagem segura por toAppError e registradas no aviso existente.
- Nenhuma migration, policy ou grant permanente foi alterado.

## Validation results — 2026-10-21 BRT

- TDD RED: 4 falhas esperadas / 30 passavam antes da implementação; evidência tdd-red-token-upgrade.log.
- Vitest final focado passou 36/36 em whatsapp-config.test.ts e send/route.test.ts; validation-focused-vitest-final.log.
- PostgreSQL 16 descartável Docker Desktop passou: owner atualizou sua config, viewer não alterou linha, conta cruzada não alterou linha, config permaneceu tenant-scoped, ausência de config e reset da identidade do pool verificados. --network none, tmpfs, mount read-only, credenciais geradas, sem portas e limpeza confirmada. Evidência validation-postgres-whatsapp-legacy-token-5a4532cf47.log.
- Um primeiro run do validator copiado apontou por engano para fixture da task anterior e foi negado por RLS; não houve acesso externo nem resíduo. O log foi preservado como validation-postgres-whatsapp-legacy-token-initial-wrong-fixture.log. O default TaskId foi corrigido; execução final acima passou usando a fixture desta task.
- npx tsc --noEmit passou; validação-typescript.log.
- ESLint focado passou com zero avisos; validation-eslint.log.
- Prettier check passou para quatro arquivos TypeScript e integração MJS.
- node --check da integração passou; git diff --check passou.
- Nenhum Supabase local/remoto, Meta/WhatsApp real, VPS, produção, tráfego, dado ou credencial real foi acessado.

## Result

The asynchronous legacy-token upgrade in `POST /api/whatsapp/send` now uses the existing server-only PostgreSQL WhatsApp config repository. Verified account scope, transaction-local identity, and RLS remain enforced. The route does not wait for the best-effort upgrade and logs a sanitized failure.

Internal and independent read-only GPT-6 Luna reviews returned `APPROVE`, zero findings and zero caveats, limited to this slice. Independent review record: `review-independent-20261021.md`.

## Follow-up

Next narrow H-DATA-003 slice: migrate only the successful-send contact-phone auto-correction write in `POST /api/whatsapp/send` to a server-only PostgreSQL repository. Message insert, conversation update, flow-run pause, and all external integrations stay separate.

## Limits

Somente PostgreSQL descartável no Docker Desktop. Preservar todas as alterações locais. Sem reset, restore, clean, rebase, troca de branch, commit, push ou deploy. Parar às 09:00 BRT de 2026-10-22. H-DATA-003/H-DB-003 continuam sem aprovação global.

## Internal review — 2026-10-21

GPT-6 Luna read-only reviewer returned APPROVE, zero findings and zero caveats within this slice. It confirmed verified-session authorization, configId/accountId predicate, transaction-local auth.uid(), RLS behavior for owner/viewer/cross-account, non-blocking route behavior and sanitized failure log. Record: review-internal-20261021.md.
