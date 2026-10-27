# Task — Leitura PostgreSQL da configuração no envio WhatsApp

- id: `20261021-040103-7c52`
- type: `migration`
- slug: `postgres-whatsapp-send-config-lookup`
- status: completed
- roadmap: H-DATA-003, phase 03

## Goal

Substituir somente a leitura PostgREST de `whatsapp_config` em `POST /api/whatsapp/send` pelo repositório PostgreSQL server-only já existente, mantendo comportamento HTTP, decryption e envio.

## Context

`src/lib/repositories/whatsapp-config.ts` já lê configuração por conta verificada e tem prova PostgreSQL 16 descartável em `.harness/tasks/20261019-230941-5159/`. A rota usa `config.id` na atualização assíncrona do token legado; retornar esse ID do repositório mantém a escrita atual inalterada nesta fatia. O lookup de template na rota recebeu revisão independente `APPROVE` na task `20261021-032540-24dd`.

## In scope

- Usar `getConnectionConfig()` para leitura da configuração da conta atual.
- Expor o ID da linha no DTO server-only apenas para preservar a atualização já existente do token legado.
- Manter status 400 quando configuração não existe e comportamento atual de decryption.
- Testar rota sem leitura PostgREST de `whatsapp_config`, incluindo caminho de configuração ausente.
- Atualizar/rodar integração PostgreSQL 16 descartável existente para conferir ID, escopo da conta, RLS e limpeza transacional após alteração do DTO.

## Out of scope

Migração da atualização do token legado, Auth/sessão/provedor, demais leituras/escritas da rota, tabelas `contacts`, `messages` e `conversations`, chamadas Meta/WhatsApp reais, Supabase, schema/RLS/grants permanentes, VPS, produção, dados/credenciais reais, H-DB-003 e aprovação global H-DATA-003.

## Validation

- Primeiro confirmar RED no teste sintético da rota.
- Vitest focado rota e repositório; integração `scripts/testing/validate-postgres-whatsapp-config.ps1` em PostgreSQL descartável Docker Desktop.
- `npx tsc --noEmit`, ESLint focado com zero avisos, Prettier check e `git diff --check`.
- Revisões interna e independente GPT-6 Luna somente leitura; repetir correções/validações/revisões até `APPROVE`, zero achados e zero ressalvas para esta fatia.

## Next action

Fatia concluída; prosseguir na próxima task estreita H-DATA-003: 20261021-044247-b6ae.

## Execution record — 2026-10-21 BRT

- O RED inicial da rota está registrado em `tdd-red-route.log`.
- `vitest-current.json` preserva a execução anterior com 49/52; as três falhas eram configuração ausente dos mocks `decrypt`/`isLegacyFormat` nos casos de template. A fixture foi corrigida e o arquivo permanece como evidência histórica, superada pela execução final.
- Vitest focado final passou 53/53 em três arquivos (`whatsapp-config.test.ts`, `template-send-definition.test.ts` e `send/route.test.ts`), incluindo configuração ausente e atualização legado do token escopada pelo `configId` PostgreSQL.
- `validate-postgres-whatsapp-config.ps1 -TaskId 20261021-040103-7c52` passou em PostgreSQL 16 descartável Docker Desktop. Evidência: `validation-postgres-whatsapp-config-220e7a73d6.log`; fixture sintética, rede sem acesso externo/portas publicadas, bind read-only e limpeza sem resíduos.
- `npx tsc --noEmit`, ESLint focado (zero avisos), Prettier check focado e `git diff --check` passaram. Repetir `git diff --check` após a atualização deste registro.
- Nenhuma chamada Meta/WhatsApp, Supabase ou ambiente externo foi usada.
- Implementação permanece limitada à leitura da configuração no endpoint. A atualização PostgREST do token legado, Auth/provedor, demais leituras/escritas e aprovação global continuam fora do escopo.

## Limits

Somente PostgreSQL descartável no Docker Desktop; sem Supabase local/remoto, Meta/WhatsApp real, VPS, produção, tráfego, dados ou credenciais reais. Preservar alterações locais. Sem reset/restore/clean/rebase/troca de branch, commit, push ou deploy. Parar às 09:00 BRT de 2026-10-22.


## Resultado final da fatia

- Revisão interna GPT-6 Luna read-only: APPROVE, zero achados e zero ressalvas.
- Revisão independente GPT-6 Luna read-only: APPROVE, zero achados e zero ressalvas. Aprovada somente a leitura de whatsapp_config em POST /api/whatsapp/send.
- Validações e evidências registradas acima permanecem válidas para esta fatia.
- Aprovação não cobre a atualização do token legado, outros writes da rota, H-DATA-003/H-DB-003 global, Supabase real, Auth, Storage, Realtime, tráfego ou produção.
- Próxima fatia: 20261021-044247-b6ae.