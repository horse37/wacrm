# Task — PostgreSQL WhatsApp template submit route

- id: `20261021-024500-6a71`
- type: `migration`
- slug: `postgres-whatsapp-template-submit-route`
- status: `completed`
- roadmap: H-DATA-003, phase 03

## Goal

Migrar a persistência local de `POST /api/whatsapp/templates/submit` para os repositórios PostgreSQL existentes, preservando a autenticação de sessão e o comportamento da integração Meta.

## Context

As fatias DELETE e PATCH de `/api/whatsapp/templates/[id]` receberam revisão independente GPT-6 Luna `APPROVE`, zero achados e zero ressalvas. O handler submit ainda consulta `profiles`, `whatsapp_config` e `message_templates` diretamente. Os repositórios de contexto/configuração e `template-submit-persistence` já existem e foram validados em PostgreSQL descartável.

## In scope

- Migrar somente leituras e gravações locais do handler POST para guards/contexto, configuração e persistência PostgreSQL existentes.
- Preservar a autenticação atual, validação do payload, categoria Authentication não suportada, dry-run, configuração/decrypt, upload do handle de imagem, chamada Meta e respostas atuais.
- Confirmar papel administrativo antes de qualquer efeito Meta; a persistência continua revalidando papel e conta dentro da transação.
- Adicionar testes focados da rota com Auth e Meta mockados para sucesso, dry-run, falha Meta persistida, configuração ausente, payload inválido e usuário/conta não autorizados.

## Out of scope

- Rota sync e quaisquer outras rotas; implementação/mudança dos repositórios; Auth replacement; migrations/schema/RLS/grants; chamadas reais Meta ou Auth; Supabase local/remoto como persistência ou alvo de validação; VPS, produção, tráfego, dados/credenciais/chips reais, Storage, Realtime, commit, push ou deploy.
- Aprovação global de H-DATA-003/H-DB-003.

## Validation

- Começar com teste RED direcionado da rota.
- Rodar Vitest direcionado da rota e repositórios utilizados; TypeScript; ESLint direcionado com `--max-warnings=0`; Prettier check; `git diff --check`.
- Reusar evidência PostgreSQL descartável existente se repositórios permanecerem inalterados. Se houver mudança de repositório, validar em PostgreSQL 16 sintético descartável no Docker Desktop, sem porta publicada, sem saída de rede externa e com cleanup verificado.
- Congelar diff/evidências e obter revisão independente GPT-6 Luna read-only até `APPROVE`, zero achados e zero ressalvas; corrigir apontamentos e repetir validações/review.

## Next action

Fatia encerrada após revisão independente GPT-6 Luna `APPROVE`, zero achados e zero ressalvas abertas. Próxima fatia H-DATA-003: `POST /api/whatsapp/templates/sync`, em task separada.

## Limites de continuidade

Preservar todas as alterações locais. Sem operações Git destrutivas ou mudança de branch. H-DATA-003/H-DB-003 seguem sem aprovação global. Parar às 09:00 BRT de 21/10/2026 e registrar o ponto de retomada.

## Implementation and validation

- `POST /api/whatsapp/templates/submit` now uses PostgreSQL account guards, lifecycle config read, and template-submit persistence. Existing server-session Auth remains. Direct Supabase data reads/writes were removed from the handler.
- Admin membership is verified before configuration access, image-handle upload, or Meta submission. The persistence repository rechecks admin/account inside its transaction.
- Preserved request validation, Authentication-category rejection, dry-run, WABA/configuration errors, image handle, Meta success/failure/rate-limit paths, local-failure recovery response, and `{ success, template, dry_run }` success envelope.
- Added route tests for admin denial before effects, invalid payload, missing configuration/WABA, successful Meta submission and PostgreSQL persistence, provider failure persistence, 429 handling, dry-run, and local persistence failure.
- TDD RED: initial focused route tests failed against legacy direct Supabase profile lookup; evidence `tdd-red-route.log`. After implementation focused Vitest plus repository/guard suites passed 57/57.
- TypeScript, targeted ESLint `--max-warnings=0`, Prettier, and `git diff --check` passed. Full results: `validation-route-submit-postgres-wiring-20261021.log`.
- PostgreSQL repository/SQL remained unchanged; reusing its existing disposable PostgreSQL 16 forced-RLS evidence at `.harness/tasks/20261020-035839-2f1e/validation-postgres-template-submit-persistence-8580d82154.log`.
- Este era o registro de implementação anterior à revisão final e foi substituído pelo resultado abaixo. Aprovação limitada a esta rota e seus registros. H-DATA-003/H-DB-003 seguem sem aprovação global. Nenhum commit, push ou deploy.

## Remediação do review independente — resposta com metadados (2026-10-21)

O review somente leitura identificou P2: a resposta de sucesso deixava de devolver `created_at`, `updated_at` e `quality_score`, presentes no registro retornado pelo handler anterior. Não era possível reconstruir esses valores com fidelidade: timestamps são geridos pelo banco e `quality_score` pode permanecer preenchido em um reenvio.

A fatia foi ampliada somente para o repositório `template-submit-persistence` selecionar e validar esses três campos em `RETURNING` explícito, sem `RETURNING *`, e para o POST incluí-los no envelope já existente. Testes cobrem insert e update; o PostgreSQL sintético confirma timestamps persistidos e preservação de `quality_score` anterior.

A ampliação não cria migration, schema, policy/RLS nem grant permanente. Os grants de coluna `SELECT (created_at, updated_at, quality_score)` aparecem apenas nas fixtures descartáveis de teste, junto da lista mínima esperada pelo validador. Configuração de privilégios fora do ambiente descartável continua fora desta task e de qualquer alegação de produção.

Validação pós-remediação: Vitest focado 57/57; TypeScript, ESLint direcionado com zero avisos, Prettier, `node --check`, AST PowerShell e `git diff --check` passaram. Prova PostgreSQL 16 Docker Desktop forçou RLS e `NOBYPASSRLS`, usou `--network none`, tmpfs, montagem somente leitura, sem portas/volumes publicados, credenciais sintéticas e confirmou cleanup sem containers residuais. Log: `validation-postgres-template-submit-persistence-051a0febf9.log`.

Fatia encerrada após aprovação independente limitada a esta rota. H-DATA-003/H-DB-003 continuam sem aprovação global.

## Revisão independente final — GPT-6 Luna (2026-10-21)

- Veredito: `APPROVE`; zero achados reproduzíveis e zero ressalvas abertas.
- Escopo: wiring PostgreSQL de `POST /api/whatsapp/templates/submit`, incluindo remediação do P2 inicial. Não aprova a migração H-DATA-003/H-DB-003 como um todo.
- O P2 foi corrigido: a resposta de sucesso inclui `created_at`, `updated_at` e `quality_score` lidos do `RETURNING` explícito e validados pelo repositório; não infere metadados nem usa `RETURNING *`.
- A revisão confirmou gate admin antes de configuração/upload/Meta, revalidação de admin/conta na transação, identidade de sessão server-side, escopo tenant/account/creator, SQL parametrizado, tratamento Meta e testes focados.
- A prova de grants limita-se à fixture descartável PostgreSQL. Não demonstra grants de ambiente persistente.
- Relatório independente: `review-gpt6-luna-final-20261021.md`.
- Fora do escopo: Supabase, Auth real, Storage, Realtime, tráfego, produção e aprovação global H-DATA-003/H-DB-003.
