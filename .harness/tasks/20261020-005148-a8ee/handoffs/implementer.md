# Implementer handoff — PostgreSQL pipeline deal stage move

## Start state

- Task `20261020-005148-a8ee`, status `in_progress`, H-DATA-003 phase 03.
- Repository root `C:\Sistemas\wacrm`; branch `main`; expected HEAD `7db4abf47dbc94a732f3ab67ac4d53ba660c9a2c`.
- Preserve all existing dirty/untracked work. PostgreSQL in disposable Docker Desktop only; no Supabase.
- No commit, push, deploy, reset, clean, rebase, or branch change.

## Scope

Implement a server-only repository operation to move a deal to another stage. Existing migration 017 authorizes deal updates to account members with minimum role `agent`; use the account guard's role check. Validate deal and stage UUIDs, set transaction-local RLS identity, and scope the UPDATE to the verified account. Require same-account deal and pipeline creators and a target stage belonging to the deal's pipeline. Preserve the existing update timestamp trigger behavior in synthetic integration proof if fixture coverage depends on it.

Do not change other deal fields/status/create/delete, schema/grants/RLS, consumers, routes, session/Auth, or other repositories.

## Validation

Start with failing Vitest. Run focused repository/account-guard tests, TypeScript, targeted ESLint (`--max-warnings=0`), Prettier, PowerShell AST/fixture whitespace, `git diff --check`, and synthetic forced-RLS PostgreSQL 16 integration. Use task-owned disposable containers, `--network none`, tmpfs, read-only mounts, generated run-only passwords, no ports/named volumes, runtime `NOBYPASSRLS`, and assert cleanup.

## Next action

## Result

TDD RED confirmed the repository module was absent. Added server-only `moveToStage(dealId, stageId)`, requiring verified membership with minimum `agent` role per migration 017. The bound UPDATE scopes the verified account, same-account deal/pipeline creators, and target stage to the deal's existing pipeline. Unit/account-guard tests passed 14/14; TypeScript, targeted zero-warning ESLint, Prettier for supported files, PowerShell AST/SQL whitespace, and `git diff --check` passed. Disposable PostgreSQL 16 forced-RLS integration passed; final evidence: `../validation-postgres-pipeline-deal-stage-move-ced1614001.log`.

Two initial integration attempts failed on test-harness issues and were corrected; failed logs remain for history. Final Docker Desktop proof used synthetic data, `NOBYPASSRLS`, network none, tmpfs, read-only mounts, stage-column-only grant, and no residual resources. No Supabase, consumer wiring, other deal mutations, Auth/session, schema/grants/RLS changes, real data, traffic, or production.

## Next action

Independent same-model GPT-6 Luna read-only review returned `APPROVE`, zero findings and caveats, limited to this slice. Reviewer confirmed role parity, single-column mutation, account/pipeline/stage/creator isolation, final Docker evidence, and cleanup. Task remains `in_progress`; consumers remain unwired. Continue to the next narrow pipeline-deal mutation without Supabase.
