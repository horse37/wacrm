# Handoff — PostgreSQL da mensagem-pai no envio WhatsApp

- Task `20261021-025715-4b73`, plano H-DATA-003 fase 03, estado `in_progress`.
- A fatia anterior `20261021-021057-20b3` migrou somente leitura de conversa/contato e recebeu `APPROVE` de revisão interna e GPT-6 Luna independente, sem achados ou ressalvas. Aprovação limitada àquela leitura.

## Trabalho desta fatia

- `src/lib/repositories/whatsapp-send-conversation.ts`: `findReplyTarget` valida UUIDs, configura a identidade verificada somente dentro da transação e consulta a mensagem por id + conversa + conta usando parâmetros. Alvo inválido, ausente ou fora do escopo retorna `null`; alvo válido devolve somente o ID do provedor, que pode ser nulo.
- `src/app/api/whatsapp/send/route.ts`: substituiu somente a leitura PostgREST da mensagem-pai. Mantém HTTP 400 para alvo não encontrado; quando o pai não tem `message_id`, envia sem contexto; com ID, preserva `context.message_id`.
- `src/app/api/whatsapp/send/route.test.ts`: cobre alvo ausente, pai sem ID Meta e pai com ID Meta; não chama serviço externo.
- Integração PostgreSQL sintética em `.harness/tasks/20261021-025715-4b73/postgres-reply-target-fixture.sql` e `scripts/testing/postgres-whatsapp-send-reply-target-integration.mjs`, executada por `scripts/testing/validate-postgres-whatsapp-send-reply-target.ps1`.

## Evidências

- Vitest focado: 11/11.
- PostgreSQL 16 no Docker Desktop: sucesso com `NOBYPASSRLS`, RLS forçado, alvo válido, pai sem ID, isolamento cross-account/cross-conversation, UUID inválido e limpeza de identidade; sem container residual. Log: `.harness/tasks/20261021-025715-4b73/validation-postgres-reply-target-2758cf528d.log`.
- TypeScript, ESLint direcionado sem avisos, Prettier nos arquivos formatáveis e `git diff --check`: sucesso.

## Próxima ação e limites

Revisões interna e independente GPT-6 Luna read-only retornaram `APPROVE`, zero achados e zero ressalvas para esta fatia. Registros: `review-internal-20261021.md` e `review-gpt6-luna-final-20261021.md`. Continuar a próxima fatia estreita H-DATA-003 autorizada pelo usuário até 09:00 BRT de 2026-10-22. Não afirmar aprovação global de H-DATA-003/H-DB-003.

Somente PostgreSQL descartável no Docker Desktop. Sem Supabase, chamadas Meta/WhatsApp reais, VPS, produção, dados/credenciais reais, Auth, schema/RLS/grants permanentes, Storage, Realtime, reset/restore/clean/rebase/troca de branch, commit, push ou deploy. Preservar todo o trabalho local. Limite: 09:00 BRT de 2026-10-22.
