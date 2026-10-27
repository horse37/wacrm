# Revisão interna — POST /api/whatsapp/broadcast

- Tipo: read-only; nenhum arquivo foi alterado durante a revisão.
- Escopo: diff da rota, teste focado, task/handoff e provas Docker PostgreSQL 16 dos repositórios chamados.
- Resultado: `APPROVE` interno; zero achados e zero ressalvas neste escopo limitado.

## Conferências

- Identidade continua vindo de `supabase.auth.getUser()` no servidor. O callback construído com esse `user.id` é compartilhado pelos repositórios de configuração e template; ambos resolvem conta e aplicam escopo PostgreSQL em suas consultas.
- A rota não consulta mais `profiles`, `whatsapp_config` ou `message_templates` via PostgREST. Nenhuma identidade ou conta é aceita do corpo da requisição.
- O rate limit continua antes de leituras PostgreSQL; respostas de configuração ausente e erros mantêm status/envelope seguro.
- Sanitização/validação de telefone, variantes, payload do provedor, tratamento por destinatário e envelope de sucesso permanecem no fluxo existente.
- Testes simulam Auth, repositórios e `sendTemplateMessage`; cobrem autorização, ausências, rate limit, falha de repositório e payload. Nenhum efeito externo real ocorre.
- Provas prévias de repositórios cobrem forced RLS, NOBYPASSRLS, escopo entre contas, grants mínimos e limpeza de identidade. O código dos repositórios/SQL/RLS/grants não mudou nesta fatia.
- `git diff --check`, Vitest 6/6, TypeScript, ESLint sem avisos e Prettier check passaram.

## Limite

Esta revisão não aprova H-DATA-003/H-DB-003 globalmente, Auth, Storage, Realtime, Supabase real, tráfego, VPS ou produção. A task permanece `in_progress` até revisão independente GPT-6 Luna.
