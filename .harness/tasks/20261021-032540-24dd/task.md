# Task — Consulta PostgreSQL da definição de template no envio WhatsApp

- ID: `20261021-032540-24dd`
- Tipo: `migration`
- Slug: `postgres-whatsapp-send-template-definition-lookup`
- Estado: `in_progress` — fatia aprovada; H-DATA-003 continua em execução na próxima fatia.
- Roteiro: H-DATA-003, fase 03.

## Objetivo

Substituir somente a leitura PostgREST de `message_templates` em `POST /api/whatsapp/send` pelo repositório PostgreSQL server-only existente. Preservar builder, payload de envio, escopo da conta e idioma padrão `en_US`.

## Implementação

- A rota chama `createPostgresTemplateSendDefinitionRepository(...).findForCurrentAccount(...)` para templates.
- O teste de rota confirma a consulta parametrizada com conta/nome/idioma, ausência de acesso PostgREST à tabela e uso da definição pelo builder.
- Casos cobrem `pt_BR` explícito, default `en_US` e definição ausente encaminhada como `undefined` para preservar o fallback do builder.
- Nenhuma alteração no repositório, SQL ou migration.

## Validação

- Vitest focado de rota e repositório: 36/36.
- TypeScript (`npx tsc --noEmit`): aprovado.
- ESLint focado: aprovado sem avisos.
- Prettier focado: aprovado.
- `git diff --check`: aprovado; Git emitiu avisos de conversão LF/CRLF já observados na árvore Windows.
- Reutilizada prova PostgreSQL 16 descartável do repositório em `.harness/tasks/20261020-031751-9e7d/validation-postgres-template-send-81e8e8dad8.log`; SQL/repositório não mudou nesta fatia e nenhum banco foi iniciado nesta validação.
- Registro dos comandos/resultados: `validation-20261021-0352.log`.

## Escopo excluído

Configuração/token WhatsApp, contatos, escrita de mensagens/conversas, Auth/sessão, integrações Meta/WhatsApp reais, schema/RLS/grants permanentes, Supabase, VPS, produção, tráfego real, dados/credenciais reais e H-DB-003.

## Próximo passo

Revisão interna e independente GPT-6 Luna read-only retornaram `APPROVE`, zero achados e zero ressalvas, limitadas a esta fatia. Registros: `review-internal-20261021.md` e `review-gpt6-luna-final-20261021.md`. A aprovação não fecha H-DATA-003/H-DB-003.
Continuar na próxima fatia estreita `20261021-040103-7c52` indicada em `.harness/current-task.md`.

## Limites operacionais

PostgreSQL descartável no Docker Desktop é o único banco permitido. Preservar alterações locais. Sem reset, restore, clean, rebase, troca de branch, commit, push ou deploy. Encerrar trabalho às 09:00 BRT de 2026-10-22.
