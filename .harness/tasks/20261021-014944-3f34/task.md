# Task — guarda PostgreSQL de conta em POST /api/whatsapp/send

- id: 20261021-014944-3f34
- type: migration
- slug: postgres-whatsapp-send-account-resolution
- status: completed
- roadmap: H-DATA-003, fase 03

## Objetivo

Substituir somente a leitura PostgREST de `profiles.account_id` em `POST /api/whatsapp/send` pelo guard de conta PostgreSQL existente.

## Contexto

A rota já autentica a sessão SSR e depois consulta `profiles` para obter a conta. O guard PostgreSQL existente resolve a mesma associação com identidade verificada, transação e RLS. Outras leituras/escritas locais da rota ficam para fatias próprias.

## Escopo

- Usar identidade já verificada pela sessão e resolver `accountId` pelo guard PostgreSQL.
- Preservar resposta 403 quando usuário não tem conta, rate limit, validação, envio e operações restantes.
- Adicionar testes focados sem chamada a serviço externo.

## Fora do escopo

Migrar outras consultas da rota, alterar Auth/sessão, enviar mensagem real, Supabase database, Meta/WhatsApp, Docker existente, schema/RLS/grants, Storage, Realtime, VPS, produção, dados/credenciais reais, commit, push ou deploy. H-DATA-003/H-DB-003 não recebem aprovação global.

## Validação

- Vitest da rota 3/3; TypeScript; ESLint direcionado com zero avisos/erros; Prettier check do teste novo; `git diff --check`. Detalhes e limitação Prettier preexistente da rota: `validation-whatsapp-send-account-20261021.log`.
- Evidência PostgreSQL 16/RLS reutilizada do guard: `.harness/tasks/20261019-214717-04f2/validation-postgres-account-guard-2b84013215.log`. Nenhum container novo foi iniciado.

## Implementação

- Substituída somente a consulta PostgREST a `profiles.account_id` pelo `createDefaultPostgresAccountGuards` existente, alimentado pelo user ID da sessão SSR verificada.
- Mantidos rate limit, validação, as demais consultas/escritas PostgREST e o fluxo de envio.
- `forbidden` do guard preserva o 403 e a mensagem anterior para membership ausente; outros erros seguem para o handler 500 existente.
- Testes focados verificam sessão ausente, membership ausente e identidade validada antes da validação do corpo, sem chamadas externas.
- Revisão interna somente leitura: `APPROVE`, zero achados de implementação; registro `internal-review-20261021.md`.

## Próxima ação

Revisão independente GPT-6 Luna read-only concluída com `APPROVE`, zero achados e zero ressalvas, limitada a esta fatia. Relatório: `review-gpt6-luna-final-20261021.md`. Próxima fatia: `20261021-021057-20b3`, leitura PostgreSQL da conversa/contato em `POST /api/whatsapp/send`.

## Resultado e revisão final

- Troca da leitura PostgREST de `profiles.account_id` pelo guard PostgreSQL existente, preservando sessão SSR, rate limit, resposta 403 e demais operações da rota.
- Vitest 3/3, TypeScript, ESLint sem avisos/erros, Prettier do teste novo e `git diff --check` passaram; evidência PostgreSQL/RLS existente foi reutilizada.
- GPT-6 Luna confirmou read-only `APPROVE`, zero achados e zero ressalvas após reler diff e evidências atuais. A aprovação cobre esta fatia apenas.
- H-DATA-003/H-DB-003 continuam em andamento e sem aprovação global.
