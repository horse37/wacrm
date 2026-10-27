# Task — Persistência PostgreSQL do recibo SSE Zap Lead

- ID: 20261022-235737-7a9c
- Tipo: migration
- Slug: postgres-zap-lead-sse-receipt-write
- Status: complete para esta fatia
- Roadmap: H-DATA-003, fase 03

## Objetivo

Migrar somente recordZapLeadSseEvent do RPC Supabase para o repositório PostgreSQL server-only, chamando a função existente e parametrizada public.record_zap_lead_sse_event. Preservar status, cursor, idempotência e tratamento de falhas.

## Implementação e validação

- TDD vermelho: tdd-red-sse-receipt-contract-20261023.log.
- Vitest focado: 9/9; TypeScript; ESLint focado com zero avisos; Prettier para arquivos TypeScript/JavaScript e registros Markdown desta task; sintaxe Node e parser PowerShell passaram.
- PostgreSQL 16 descartável aplicou migrations 001–028 e validou accepted, duplicate, tipo não suportado, divergência conta/chave, cursor stale, avanço e concorrência. Evidência: validation-postgres-zap-lead-sse-event-receipt-2a43589fe6.log.
- O grant EXECUTE existiu somente no banco descartável; nenhuma migration ou privilégio permanente mudou.
- git diff --check passou.

## Revisões

- Revisão interna somente leitura: APPROVE, zero achados; review-internal.md.
- Revisão independente GPT-6 Luna: APPROVE, zero achados e zero ressalvas, limitada a esta fatia; review-independent.md.
- A confirmação independente final inspecionou a definição efetiva da função em migration 026, que redefine a função introduzida em 025; a integração aplicou 001–028.
- O revisor observou que a validação não lista troca de geração da credencial como cenário exercitado; isso não foi tratado como achado/ressalva, pois a função e migration são preexistentes e fora do escopo desta fatia.

## Riscos e limites

O privilégio EXECUTE de runtime e a matriz H-DB-003 continuam pendentes. O review integral Opus 5.5 r2 permanece REMEDIATION_REQUIRED e aguarda nova revisão do proprietário. H-DATA-003 e H-DB-003 não estão aprovados globalmente. Sem Supabase, VPS, produção, dados/credenciais/tráfego reais, banco persistente, commit, push ou deploy.

## Próxima tarefa

20261023-004958-ea9f, postgres-zap-lead-heartbeat-writes: migrar somente as três gravações do heartbeat para o repositório PostgreSQL server-only.
