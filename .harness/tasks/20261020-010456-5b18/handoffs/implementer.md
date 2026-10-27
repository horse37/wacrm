# Implementer handoff — PostgreSQL pipeline deal creation

## Start state

- Task `20261020-010456-5b18`, status `in_progress`, H-DATA-003 phase 03.
- Repository root `C:\Sistemas\wacrm`; branch `main`; expected HEAD `7db4abf47dbc94a732f3ab67ac4d53ba660c9a2c`.
- Preserve all existing dirty/untracked work. Use PostgreSQL in task-owned disposable Docker Desktop only; do not use Supabase.
- No commit, push, deploy, reset, clean, rebase, or branch change.

## Scope

Implement a server-only repository to create a deal with the fields used by the existing deal form. Require a verified session and minimum `agent` role; derive creator user/account IDs from the verified account context. Set status to `open`. Validate runtime inputs, require pipeline and its creator, stage in that pipeline, same-account contact, and optional same-account assignee. Return safe not-found if related records are missing or outside the account. Use parameterized SQL and transaction-local RLS identity.

Do not wire UI/routes or change Auth/session, existing deal mutations, schema/grants/RLS, other repositories, or external services.

## Validation

TDD RED confirmed module absence. Focused repository/account-guard Vitest passed 16/16; TypeScript, targeted ESLint (`--max-warnings=0`), Prettier for supported files, PowerShell AST/fixture least-privilege checks, and `git diff --check` passed. Disposable Docker Desktop PostgreSQL 16 forced-RLS integration passed with synthetic data, runtime `NOBYPASSRLS`, column-level INSERT grants only, `--network none`, tmpfs, read-only repository mounts, generated run-only passwords, no ports/named volumes, and no residual resources. Evidence: `../validation-postgres-pipeline-deal-create-7c6a548346.log`. Independent same-model GPT-6 Luna read-only review returned `APPROVE`, zero findings/caveats, limited to this slice.

Continue to the next narrow pipeline-deal PostgreSQL repository slice. Keep this task `in_progress` and consumers unwired; review approval is scoped to deal creation only.
