# Revisão interna — alvo de resposta citada

- **Data:** 2026-10-21, America/Sao_Paulo
- **Task:** `20261021-025715-4b73`
- **Modo:** somente leitura; sem editar código durante a revisão
- **Veredito:** `APPROVE` para esta fatia, zero achados e zero ressalvas

## Escopo revisado

Somente o novo `findReplyTarget`, sua chamada em `POST /api/whatsapp/send`, testes da rota e prova PostgreSQL/RLS da mensagem-pai. O lookup anterior de conversa/contato foi aprovado separadamente e não é reaberto aqui, salvo regressão direta.

## Verificações

- SQL parametrizado vincula id da mensagem, id da conversa e conta verificada; o join deriva a conta pela conversa. O acesso ocorre na mesma transação que define localmente a identidade verificada.
- UUID inválido, alvo ausente, outra conversa e outra conta não produzem alvo. A rota preserva HTTP 400 para pai não encontrado.
- `message_id` nulo mantém o envio sem contexto; valor presente continua como `context.message_id`.
- Testes sintéticos da rota passaram 11/11; não houve chamada a Meta/WhatsApp.
- PostgreSQL 16 descartável passou com role `NOBYPASSRLS`, RLS forçado, isolamento de conta/conversa, caso sem ID do provedor, limpeza da identidade e nenhum container residual.
- TypeScript, ESLint direcionado sem avisos, Prettier e `git diff --check` passaram.

## Limites

Veredito restrito ao lookup da mensagem-pai e aos arquivos/evidências desta fatia. Não aprova outras consultas/gravações da rota, Auth, mudanças permanentes de RLS/grants, Supabase, tráfego real, H-DATA-003 ou H-DB-003 globalmente.
