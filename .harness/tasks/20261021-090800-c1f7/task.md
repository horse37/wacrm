# Task — Busca PostgreSQL da credencial do webhook Zap Lead

- id: `20261021-090800-c1f7`
- slug: `postgres-zap-lead-webhook-credential-read`
- status: `completed`
- roadmap: H-DATA-003, phase 03

## Objetivo

Migrar somente a consulta da credencial por `keyId` usada por `POST /api/zap-lead/webhook` de PostgREST para repositório PostgreSQL server-only. Preservar validação, descriptografia, igualdade estrita da chave, resposta para chave ausente e erro genérico.

## Segurança implementada

- Consulta parametrizada dentro de uma transação PostgreSQL.
- Filtro `keyId` fica em GUC local à transação; na fixture, a policy RLS compara a linha com esse valor.
- Na fixture PostgreSQL descartável, `wacrm_runtime` não tem `BYPASSRLS`, não é dono da tabela, não tem SELECT na tabela inteira nem acesso de escrita.
- A fixture concede SELECT somente nas colunas `key_id`, `account_id` e `encrypted_registration` e define policy RLS que limita a linha ao `keyId` da transação; ela também força RLS para testar o papel proprietário. As migrations atuais não provisionam esse papel, grants ou policy.
- A solução não usa `SECURITY DEFINER`; portanto não há proprietário de função com privilégio capaz de ignorar RLS.
- A validação Docker cria a fixture com `SET ROLE postgres`; isso não aplica uma migration do projeto. O papel sintético sem login, superuser ou `BYPASSRLS` é dono somente das tabelas da fixture.

## Revisões

GPT-6 Luna inicialmente retornou `REMEDIATION_REQUIRED`, um achado P2: a função `SECURITY DEFINER` era atribuída a `postgres`; uma instalação onde esse papel seja superuser ignora RLS mesmo com `FORCE ROW LEVEL SECURITY`. A fixture anterior mascarava isso ao criar `postgres` sem superuser. A função foi removida e substituída por consulta direta com grant de colunas e RLS. A revisão independente read-only da remediação retornou `APPROVE`, zero achados e zero ressalvas. Registro: `review-independent-20261021.md`.

## Escopo

- Somente lookup de `account_id` e `encrypted_registration` por `keyId`.
- Sem alteração de HMAC, nonce, ingestão, contrato HTTP, escrita/rotação de credenciais, health targets ou outros endpoints.
- Sem expansão geral de RLS, Supabase, tráfego externo, VPS, produção, dados ou credenciais reais.
- PostgreSQL 16 descartável no Docker Desktop é o único banco permitido.
- Preservar todas as alterações locais. Sem commit, push ou deploy.
- Finalizar esta task e parar; não iniciar a próxima.

## Validações

- TDD: contrato transacional novo falhou contra implementação antiga; após correção, testes focados passaram 35/35.
- TypeScript (`npx tsc --noEmit`): passou.
- ESLint focado (`--max-warnings=0`): passou.
- Prettier focado: passou.
- `node --check` do integrador e análise sintática PowerShell: passaram.
- PostgreSQL 16 descartável: RLS forçada, proprietário sem superuser/BYPASSRLS, isolamento por chave, grants de colunas, negação de leitura sem escopo e de coluna extra, limpeza do GUC: passou. Log: `validation-postgres-zap-lead-webhook-credential-read-09bc28440e.log`.
- `git diff --check`: passou após atualização dos artefatos Harness.
- Revisão interna pós-correção: `APPROVE`, nenhum achado aberto; `review-internal-20261021.md`.
- Revisão independente GPT-6 Luna read-only: `APPROVE`, zero achados e zero ressalvas; `review-independent-20261021.md`.

## Limites do resultado

Qualquer aprovação vale apenas para esta fatia. H-DATA-003 e H-DB-003 não estão aprovados globalmente. Supabase real, Auth, Storage, Realtime, tráfego de aplicação, VPS e produção seguem fora do escopo.

## Fechamento

Task concluída e encerrada após aprovação independente. Nenhuma task seguinte foi iniciada; sem commit, push ou deploy.


## Bloqueio de ativação identificado em review posterior
- O repositório e a fixture desta task demonstram um contrato PostgreSQL sintético; as migrations versionadas não criam `wacrm_runtime`, não concedem permissões de coluna a esse papel nem criam a policy `zap_lead_webhook_credential_lookup`.
- Portanto, `POST /api/zap-lead/webhook` não está pronto para ativação com o runtime PostgreSQL. Até uma task H-DB-003 aprovada versionar/provisionar o papel, os grants mínimos e a policy compatível, não habilitar nem implantar esse caminho. Sem a policy, RLS pode ocultar uma credencial válida e produzir resposta 401.
- Esta dependência é bloqueio explícito, não resolvido nesta task. Fixture e testes não comprovam compatibilidade com migrations instaláveis nem readiness de Auth/RLS. Nenhuma alteração permanente de schema, RLS ou grants está autorizada nesta remediação.


## Divergências explícitas da fixture em relação às migrations
1. As policies de 024/025 têm `TO authenticated`; a fixture substitui esse alvo pelo papel sintético `wacrm_runtime`.
2. A migration 017 declara `is_account_member` como `SECURITY DEFINER`; a fixture usa `SECURITY INVOKER`.
3. A fixture acrescenta policy `profiles_select` para `wacrm_runtime` e `GRANT SELECT` em `profiles`; essa combinação runtime-específica não existe na cadeia de migrations.
Essa diferença é intencional para provar um contrato candidato de runtime, não paridade com migrations. H-DB-003 continua responsável por definir e validar o contrato instalável; nenhuma aprovação desta task cobre essa compatibilidade.
