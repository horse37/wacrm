# Task — Leitura PostgreSQL de GET Zap Lead registration

- **ID:** 20261021-072715-1f87
- **Tipo:** migration
- **Slug:** postgres-zap-lead-registration-get
- **Estado:** complete; revisões interna e independente GPT-6 Luna APPROVE, zero achados e zero ressalvas, limitadas ao GET registration
- **Plano:** H-DATA-003, fase 03

## Objetivo

Migrar apenas as leituras da configuração e do estado técnico de heartbeat usadas por `GET /api/zap-lead/registration` para um repositório PostgreSQL server-only.

## Escopo implementado

- A GET mantém `requireRole('admin')` e deixa de consultar PostgREST nas tabelas `zap_lead_integrations` e `zap_lead_integration_state`.
- Repositório usa SQL parametrizado, limita cada consulta por `account_id`, limita o estado também por `integration_key_id`, e define `request.jwt.claim.sub` transaction-local.
- A projeção inclui só `api_base_url`, `key_id` e os quatro campos técnicos publicados de heartbeat.
- Respostas sem configuração, sem estado de heartbeat e erros HTTP publicados foram preservados.
- POST, DELETE, credenciais, Auth/sessão e chamadas externas não mudaram.

## Evidências de TDD

- `tdd-red-registration-get-20261021.log`: os quatro testes da rota falharam antes da implementação porque a GET continuava em PostgREST e convertia erros nos textos genéricos do middleware.
- `tdd-red-repository-registration-read-20261021.log`: o teste do repositório falhou antes de sua criação porque o módulo ainda não existia.

## Validações concluídas

- Vitest focado nas duas rotas e no repositório: 12/12.
- `npx tsc --noEmit`: aprovado.
- ESLint focado: aprovado, sem avisos.
- Prettier `--check` nos cinco arquivos TypeScript alterados: aprovado.
- `node --check` no script de integração e parser PowerShell sem erros.
- PostgreSQL 16 descartável no Docker Desktop: aprovado. Execução usa `--network none`, dados somente em `tmpfs`, bind mount read-only do repositório, role sem `BYPASSRLS`, RLS forçada e fixture sintética. Testou isolamento por conta/chave, viewer/admin, projeção sem segredo e limpeza da identidade transaction-local. Sem containers residuais. Log: `validation-postgres-zap-lead-registration-read-a874989e64.log`.
- Revisão interna read-only: APPROVE, zero achados/ressalvas; `.harness/tasks/20261021-072715-1f87/review-internal-20261021.md`.
- Revisão independente GPT-6 Luna: APPROVE, zero achados/ressalvas; `review-independent-20261021.md`.

## Limites

Esta aprovação, se obtida, cobre apenas a GET e sua prova PostgreSQL descartável. H-DATA-003 e H-DB-003 continuam sem aprovação global. Supabase, PostgreSQL real, Auth, Storage, Realtime, tráfego, dados/credenciais reais, VPS e produção ficam fora do escopo. Não fazer commit, push ou deploy.

## Próxima ação

Fatia concluída e aprovada. Próxima task: `20261021-081500-6525`, leitura PostgreSQL do alvo/cursor do stream de eventos. H-DATA-003 permanece `in_progress`; parar às 09:00 BRT de 2026-10-22.
