# Implementer handoff — `20261021-090800-c1f7`

## Estado

A revisão independente encontrou P2: `SECURITY DEFINER` era propriedade de `postgres`, potencial superuser em instalações comuns; a fixture anterior criava esse papel sem superuser e não validava os atributos do proprietário.

Correção aplicada: remover a função definidora e consultar diretamente `zap_lead_integrations` em uma transação. O repository define o filtro de chave por `set_config(..., true)` e lê apenas `account_id` e `encrypted_registration`. Na fixture descartável, grants concedem SELECT somente em `key_id`, `account_id` e `encrypted_registration`, e policy RLS limita as linhas ao `keyId` da transação. Isso não descreve as migrations atuais: elas não provisionam `wacrm_runtime`, esses grants ou essa policy. A prova aplica a fixture (não migration do projeto) com `SET ROLE postgres` e verifica que o dono sintético não é superuser nem tem `BYPASSRLS`.

Contrato de `credentials.ts` e da rota webhook permanece igual. Sem uso de Supabase em validação; PostgreSQL 16 é descartável, Docker `--network none`, sem portas publicadas, dados sintéticos e bind do repositório somente leitura.

## Evidências pós-correção

- Vitest focado: 35/35.
- `npx tsc --noEmit`: passou.
- ESLint focado com `--max-warnings=0`: passou.
- Prettier e `node --check` do integrador: passaram.
- Parser PowerShell: passou.
- PostgreSQL 16 RLS/grants/isolamento: passou; `validation-postgres-zap-lead-webhook-credential-read-09bc28440e.log`.
- `git diff --check`: passou antes desta atualização documental; repetir antes de concluir.

## Fechamento

Revisão interna read-only concluiu `APPROVE`, sem achados abertos. Revisão independente GPT-6 Luna read-only concluiu `APPROVE`, zero achados e zero ressalvas; registro em `../review-independent-20261021.md`. Task `20261021-090800-c1f7` concluída. Nenhuma task seguinte iniciada; parar aqui.


## Bloqueio operacional descoberto em review posterior
- Não habilitar nem implantar `POST /api/zap-lead/webhook` no runtime PostgreSQL antes de H-DB-003 versionar/provisionar `wacrm_runtime`, os grants mínimos de coluna e a policy `zap_lead_webhook_credential_lookup` compatível com o papel real.
- As migrations atuais não criam esse papel, grants ou policy; a policy/grants do teste existem apenas na fixture descartável. Sem a policy, RLS pode retornar zero linhas para uma chave válida e a rota responder 401.
- Esta é uma dependência bloqueante, não uma migration permitida nesta task. Aprovação anterior não demonstra readiness operacional nem compatibilidade com a cadeia de migrations.


## Divergências explícitas da fixture e migrations
1. Policies nas migrations 024/025 usam `TO authenticated`; fixture aponta para `wacrm_runtime` sintético.
2. `is_account_member` da migration 017 é `SECURITY DEFINER`; a função da fixture é `SECURITY INVOKER`.
3. Fixture adiciona policy runtime-specific `profiles_select` e `GRANT SELECT ON profiles`, inexistentes com esse escopo nas migrations.
A fixture serve ao contrato candidato do runtime e não prova equivalência com migrations. Compatibilidade instalável permanece bloqueada para H-DB-003.
