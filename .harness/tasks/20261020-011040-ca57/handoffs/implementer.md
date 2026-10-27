# Implementer handoff — PostgreSQL pipeline deal details update

## Start state

- Task `20261020-011040-ca57`, status `in_progress`, H-DATA-003 phase 03.
- Repository root `C:\Sistemas\wacrm`; branch `main`; expected HEAD `7db4abf47dbc94a732f3ab67ac4d53ba660c9a2c`.
- Preserve existing dirty/untracked work. Use PostgreSQL in task-owned disposable Docker Desktop only; no Supabase.
- No commit, push, deploy, reset, clean, rebase, or branch change.

## Scope

Implement a server-only operation to update the existing deal form fields: title, value, currency, contact, stage, optional assignee, notes, and expected close date. Require verified membership with minimum `agent` role and transaction-local RLS identity. Scope the deal to the verified account and existing pipeline; preserve pipeline, account, creator, and status. Require same-account deal/pipeline creators, stage in the deal's pipeline, and same-account contact/assignee. Validate runtime values and return safe not-found for inaccessible relationships.

Do not wire UI/routes or modify create/status/delete, Auth/session, schema/grants/RLS, or other repositories.

## Validation

TDD RED confirmed the module was absent. Repository plus account-guard Vitest passed 15/15; TypeScript passed; targeted ESLint passed with zero warnings; Prettier, PowerShell AST/fixture least-privilege checks, and `git diff --check` passed. Disposable Docker Desktop PostgreSQL 16 forced-RLS integration passed with synthetic data, runtime `NOBYPASSRLS`, only eight column-level UPDATE grants, `--network none`, tmpfs, read-only mounts, generated run-only passwords, no ports/named volumes, and no residual resources. Final evidence: `../validation-postgres-pipeline-deal-details-update-f135cd2ed5.log`. The initial runner attempt failed because it retained the previous task's role identifier, with no residual resources; its log is `../validation-postgres-pipeline-deal-details-update-14215ec811.log`. The runner role name was corrected before the final successful run.

Fresh independent same-model GPT-6 Luna read-only review returned `APPROVE`, zero findings, and zero caveats for this slice. Keep task `in_progress` and consumers unwired; next inspect and implement the existing deal-delete operation with role/relational effects explicitly tested.

## Scope boundary

This slice does not approve H-DATA-003/H-DB-003 overall and does not cover UI/API wiring, H-SELF-002, Supabase/Auth replacement, schema/grants/RLS, Storage, Realtime, real credentials/data, application traffic, or production. No commit, push, or deploy occurred. The next candidate is the existing deal delete flow. The product's no-delete rule applies to message records, not deals; inspect deal schema side effects before implementation.
