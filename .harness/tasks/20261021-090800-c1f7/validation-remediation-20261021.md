# Validação da remediação — 20261021-090800-c1f7

## Alteração motivada pela revisão

A revisão independente encontrou risco P2 no proprietário da função `SECURITY DEFINER`: `postgres` pode ser superuser e ignorar RLS. A correção remove a função e usa consulta parametrizada direta em transação, grant SELECT apenas de `key_id`, `account_id` e `encrypted_registration`, e policy RLS atrelada ao GUC local. Fixture força RLS e testa o proprietário da tabela sem superuser nem `BYPASSRLS`.

## TDD

- RED: `npx vitest run --reporter=dot src/lib/repositories/zap-lead-webhook-credential-read.test.ts` falhou nos seis casos contra a implementação antiga, pois ainda chamava `queryDb` e não executava a transação/GUC esperada.
- GREEN: `npx vitest run --reporter=dot src/lib/repositories/zap-lead-webhook-credential-read.test.ts src/lib/zap-lead/credentials.test.ts src/app/api/zap-lead/webhook/route.test.ts` passou: 3 arquivos, 35 testes.

## Checagens

- `npx tsc --noEmit`: exit 0.
- `npx eslint src/lib/repositories/zap-lead-webhook-credential-read.ts src/lib/repositories/zap-lead-webhook-credential-read.test.ts scripts/testing/postgres-zap-lead-webhook-credential-read-integration.mjs --max-warnings=0`: exit 0.
- `npx prettier --check` nos dois arquivos TypeScript e integrador MJS: passou.
- `node --check scripts/testing/postgres-zap-lead-webhook-credential-read-integration.mjs`: exit 0.
- Parser PowerShell de `validate-postgres-zap-lead-webhook-credential-read.ps1`: sem erros.
- `git diff --check`: exit 0; apenas avisos de conversão LF/CRLF em alterações locais preexistentes.

## PostgreSQL descartável

`powershell -NoProfile -ExecutionPolicy Bypass -File scripts/testing/validate-postgres-zap-lead-webhook-credential-read.ps1`: sucesso em PostgreSQL 16 e Node 22 do Docker Desktop, `--network none`, banco em tmpfs, bind do repositório read-only e sem porta publicada. Fixture e contas sintéticas. Migration executada com `SET ROLE postgres`; esse papel é NOLOGIN, NOSUPERUSER e NOBYPASSRLS. Prova confirmou RLS forçada, runtime NOBYPASSRLS, grants mínimos por coluna, isolamento entre duas chaves, bloqueio sem GUC, bloqueio de coluna não concedida e limpeza transacional. Containers descartáveis removidos; nenhum resíduo.

Log: `validation-postgres-zap-lead-webhook-credential-read-09bc28440e.log`.

## Limites

Não foram executados suíte completa, build, E2E, Supabase, tráfego externo, VPS ou produção. A revisão independente da correção ainda precisa aprovar sem achados/ressalvas.
