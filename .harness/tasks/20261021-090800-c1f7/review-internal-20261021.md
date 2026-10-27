# Revisão interna pós-remediação — 20261021-090800-c1f7

## Resultado

**APPROVE interno — nenhum achado aberto**, limitado ao lookup PostgreSQL da credencial do webhook por `keyId`. Revisão independente GPT-6 Luna também aprovou, com zero achados e zero ressalvas; parecer em `review-independent-20261021.md`.

## Resposta ao achado P2

A implementação anterior usava uma função `SECURITY DEFINER` cujo owner era chamado `postgres`. A fixture anterior criava esse papel como não-superuser, o que não demonstrava segurança se esse owner fosse superuser real. A correção remove a função completamente. O runtime consulta diretamente por SQL parametrizado em uma transação, com RLS por `keyId` e grant só de `key_id`, `account_id` e `encrypted_registration`. Logo, o lookup não depende de privilégios de owner de função; role superuser não participa da consulta da aplicação.

## Revisão read-only

- `credentials.ts` preserva validação, descriptografia, igualdade estrita do `keyId` e erro genérico; rota/contrato HTTP não foram alterados.
- Repository rejeita chave malformada antes de acessar banco; GUC é transaction-local e query usa `$1`; trata zero, duplicidade e linhas inválidas sem expor erro do PostgreSQL.
- Migration substitui apenas a policy de lookup, retira grants de tabela do runtime e concede SELECT nas três colunas requeridas. RLS limita linha ao GUC; tabela já tem RLS habilitada pela migration 024. Não existe função `SECURITY DEFINER` para owner superuser contornar RLS.
- Integração verifica RLS forçada no fixture, atributos do owner da tabela, runtime `NOSUPERUSER/NOBYPASSRLS`, isolamento entre keys, sem GUC, coluna extra, grants de escrita e limpeza ao devolver conexão.
- Migration é aplicada na prova como `SET ROLE postgres`; no fixture esse role é `NOLOGIN NOSUPERUSER NOBYPASSRLS` e dono da tabela. Docker usa somente dados sintéticos, rede isolada, tmpfs e bind read-only.
- Alterações permanecem dentro da fatia e artefatos da task. Nenhum commit, push, deploy, Supabase, VPS ou produção.

## Verificações revisadas

- TDD RED/GREEN: 35/35 focados.
- TypeScript, ESLint focado sem avisos, Prettier, sintaxe Node e PowerShell: passaram.
- PostgreSQL 16 descartável: passou, `validation-postgres-zap-lead-webhook-credential-read-09bc28440e.log`.
- `git diff --check`: passou.

## Limite

Este parecer não aprova H-DATA-003 nem H-DB-003 globalmente, e não valida Supabase real, Auth, Storage, Realtime, tráfego externo, VPS ou produção.
