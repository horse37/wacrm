# Task — PostgreSQL do alvo de resposta citada no envio WhatsApp

- **ID:** `20261021-025715-4b73`
- **Tipo:** migration
- **Slug:** `postgres-whatsapp-send-reply-target-lookup`
- **Estado:** `in_progress`
- **Plano:** H-DATA-003, fase 03

## Objetivo

Substituir somente a leitura PostgREST da mensagem-pai (`reply_to_message_id`) em `POST /api/whatsapp/send` por leitura PostgreSQL com escopo da conta já verificada. Preservar HTTP 400 quando o alvo não pertence à conversa e o contexto de resposta enviada ao provedor quando a mensagem-pai tem `message_id`.

## Contexto

A fatia anterior desta rota migrou a consulta de conversa/contato e recebeu revisões interna e independente GPT-6 Luna `APPROVE`, zero achados e zero ressalvas. Ela não aprovou as demais consultas da rota nem H-DATA-003/H-DB-003 globalmente.

## Escopo

- Resolver a mensagem-pai por id, conversa e conta verificada, sem carregar a conversa inteira.
- Usar predicados SQL parametrizados e identidade PostgreSQL local à transação.
- Para pai existente sem `message_id` do provedor, enviar sem contexto de resposta, preservando o comportamento anterior.
- Cobrir os caminhos da rota com fixtures sintéticas e provar isolamento com PostgreSQL descartável e RLS.

## Fora do escopo

Outras leituras/gravações da rota (`whatsapp_config`, `message_templates`, `messages` insert/update, `contacts`, `conversations`), Auth/sessão/provedor, chamadas Meta/WhatsApp, mudanças permanentes em schema/migration/RLS/grants, Storage, Realtime, Supabase, VPS, produção, tráfego, dados/credenciais reais e aprovação global H-DATA-003/H-DB-003.

## Restrições

Preservar todo trabalho local. Não executar reset, restore, clean, rebase, troca de branch, commit, push ou deploy. Usar somente PostgreSQL sintético e descartável no Docker Desktop. Encerrar às 09:00 BRT de 2026-10-22.

## Validação concluída — 2026-10-21

- Testes focados da rota: Vitest 11/11.
- PostgreSQL 16 descartável: passou com role `NOBYPASSRLS`, RLS forçado, alvo válido, pai sem ID do provedor, isolamento entre conta/conversa, UUID inválido e limpeza da identidade transacional. Evidência: `validation-postgres-reply-target-2758cf528d.log`; nenhum container residual.
- TypeScript, ESLint direcionado com `--max-warnings=0`, Prettier nos arquivos formatáveis da fatia e `git diff --check`: passaram. `git diff --check` mostrou apenas avisos de normalização LF/CRLF no checkout.

## Estado da revisão

Revisões interna e independente GPT-6 Luna read-only retornaram `APPROVE`, zero achados e zero ressalvas. Registros: `review-internal-20261021.md` e `review-gpt6-luna-final-20261021.md`. Aprovação limitada ao lookup da mensagem-pai desta fatia; task umbrella e H-DATA-003/H-DB-003 permanecem sem aprovação global.

## Próxima ação

Continuar a próxima fatia estreita H-DATA-003 do plano sem ultrapassar 09:00 BRT de 2026-10-22.
