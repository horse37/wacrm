# Reviewer handoff — `20261021-090800-c1f7`

## Revisão anterior

GPT-6 Luna retornou `REMEDIATION_REQUIRED` com um P2: a função `SECURITY DEFINER` pertencia a `postgres`; uma instalação pode tornar esse role superuser, que ignora RLS. A fixture criava `postgres` sem superuser e não verificava `rolsuper`.

## Remediação para revisar

A função foi removida. O repository agora faz lookup direto e parametrizado dentro de transação, definindo `app.wacrm_zap_lead_webhook_key_id` como GUC local. Migration concede a `wacrm_runtime` somente SELECT de `key_id`, `account_id` e `encrypted_registration`; policy RLS retorna apenas a linha correspondente ao GUC. Sem owner de função, não há privilégio `SECURITY DEFINER` capaz de ignorar RLS.

Validar especialmente se o uso de consulta direta sob RLS elimina o achado sem ampliar permissões do runtime, se a policy filtra também query sem chave e keyId cruzado, e se o desenho é compatível com a transação/pool. A fixture PostgreSQL 16 força RLS, executa a migration por `SET ROLE postgres` e verifica `rolsuper=false` e `rolbypassrls=false` do owner da tabela.

## Evidência

- Foco Vitest 35/35; TypeScript; ESLint sem avisos; Prettier; sintaxe Node/PowerShell; `git diff --check` passaram.
- PostgreSQL 16 Docker Desktop descartável, `--network none`, tmpfs, fixture sintética, repositório read-only: `validation-postgres-zap-lead-webhook-credential-read-09bc28440e.log`.
- Parecer interno pós-remediação: `review-internal-20261021.md`.

## Limites

Revisão read-only desta fatia. Não aprovar H-DATA-003/H-DB-003 globalmente. Sem Supabase real, Auth, Storage, Realtime, tráfego externo, VPS ou produção. Não editar arquivos.

## Resultado final — revisão independente

- GPT-6 Luna, somente leitura: **APPROVE**, zero achados e zero ressalvas.
- Escopo: lookup PostgreSQL da credencial do webhook Zap Lead por `keyId` nesta task.
- Confirmado: ausência de `SECURITY DEFINER`; consulta parametrizada na mesma transação/cliente PostgreSQL; GUC local à transação; runtime sem `BYPASSRLS`, com SELECT apenas nas três colunas necessárias; RLS forçada, isolamento entre chaves, lookup sem escopo vazio e limpeza do GUC.
- Parecer completo: `../review-independent-20261021.md`.
- Aprovação limitada a esta fatia; H-DATA-003/H-DB-003 continuam sem aprovação global.
