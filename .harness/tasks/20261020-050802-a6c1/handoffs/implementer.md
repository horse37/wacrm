# Implementer handoff — PostgreSQL flow-header update persistence

## Start state

- Task `20261020-050802-a6c1`, status `in_progress`, H-DATA-003 phase 03.
- Repository `C:\Sistemas\wacrm`; branch `main`; expected HEAD `7db4abf47dbc94a732f3ab67ac4d53ba660c9a2c`.
- Preserve all dirty and untracked files. Use synthetic PostgreSQL in disposable Docker Desktop only; never Supabase.
- No commit, push, deploy, reset, clean, rebase, or branch change.

## Scope

Implement a server-only repository to update only the allowlisted flow-header fields (`name`, `description`, `trigger_type`, `trigger_config`, `entry_node_id`, `fallback_policy`) for an agent-or-higher member's verified account. Use parameterized SQL, transaction-local RLS identity, database constraints, and safe not-found behavior. Do not touch route/UI wiring or graph nodes.

## Validation

Begin with a failing focused Vitest. Run focused tests, TypeScript, targeted zero-warning ESLint, Prettier, PowerShell AST/fixture checks, `git diff --check`, and task-owned disposable Docker Desktop PostgreSQL 16 proof with forced RLS, `NOBYPASSRLS`, exact column grants, account/role isolation, generated credentials, synthetic data, `--network none`, tmpfs, read-only mounts, and cleanup checks. Obtain fresh independent GPT-6 Luna read-only review and remediate until exact `APPROVE`, zero findings/caveats.

## Restrictions

No Supabase use, route wiring, Auth/session provider work, node/graph writes, provider calls, permanent schema/grant/RLS changes, real credentials/data, application traffic, production, commit, push, or deploy. Keep the task `in_progress`; H-DATA-003/H-DB-003 remain unapproved overall.

## Implementation and validation

- TDD RED confirmed the repository module was absent. Focused Vitest passed 8/8; combined flow-header, flow-delete, and flow-editor-load tests passed 27/27.
- Added only an unwired, account-scoped header update repository with an explicit six-field allowlist, agent-or-higher guard, transaction-local identity, bound values, and safe not-found behavior. Status and graph rows remain outside its update grants and SQL.
- TypeScript, targeted zero-warning ESLint, Prettier, PowerShell AST, and `git diff --check` passed.
- Disposable Docker Desktop PostgreSQL 16 forced-RLS integration passed exact grants, `NOBYPASSRLS`, account/role isolation, header persistence, status denial, and identity cleanup using synthetic-only data, `--network none`, tmpfs, read-only mounts, generated credentials, and cleanup verification. Evidence: `validation-postgres-flow-header-update-b089a62b10.log`.
- Independent GPT-6 Luna read-only review returned exact `APPROVE`, zero findings, and zero caveats for this slice only. The route remains unwired; task remains `in_progress` and H-DATA-003/H-DB-003 remain unapproved overall.

## Independent read-only review

- Reviewer confirmed `main`, expected HEAD, and task `in_progress`; approved only the unwired header-update repository, focused tests, fixture/runner, and recorded disposable PostgreSQL evidence.
- No findings or caveats within this slice. The approval does not cover route wiring, H-DATA-003/H-DB-003 overall, Auth/session migration, Supabase replacement, Storage, Realtime, application traffic, or production.
