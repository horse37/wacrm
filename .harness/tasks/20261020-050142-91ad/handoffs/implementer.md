# Implementer handoff — PostgreSQL flow-delete persistence

## Start state

- Task `20261020-050142-91ad`, status `in_progress`, H-DATA-003 phase 03.
- Repository `C:\Sistemas\wacrm`; branch `main`; expected HEAD `7db4abf47dbc94a732f3ab67ac4d53ba660c9a2c`.
- Preserve all dirty/untracked files. PostgreSQL runs only as task-owned disposable Docker Desktop resources; never Supabase.
- No commit, push, deploy, reset, clean, rebase, or branch change.

## Scope

Add an unwired server-only repository that deletes a flow only when the verified account context belongs to an agent and the flow's owner user ID/account match that context. Use parameterized SQL, transaction-local RLS identity, a safe not-found outcome, and rely on the existing FK cascades for child rows. Keep route/UI and Auth/session changes out of scope.

## Validation

Start with a failing focused Vitest. Run focused tests, TypeScript, targeted zero-warning ESLint, Prettier, PowerShell AST/fixture checks, `git diff --check`, and disposable Docker Desktop PostgreSQL 16 integration with forced RLS, `NOBYPASSRLS`, exact minimum grants, synthetic data/generated credentials, `--network none`, tmpfs, read-only mounts, cascade/concurrency checks, and cleanup verification. Obtain a fresh independent GPT-6 Luna read-only review and remediate until exact `APPROVE`, zero findings/caveats.

## Next action

The flow-delete repository slice received independent GPT-6 Luna read-only exact `APPROVE`, zero findings, and zero caveats. Continue with the next isolated flow persistence slice; keep routes unwired.

## Implementation and validation

- TDD RED confirmed the repository was absent; focused Vitest passed 7/7. TypeScript, targeted zero-warning ESLint, Prettier, and `git diff --check` passed.
- Added the unwired owner/account-scoped delete with verified agent authorization, transaction-local RLS identity, parameterized predicates, checked returned ID, and safe not-found behavior.
- Docker Desktop PostgreSQL 16 integration passed forced RLS, `NOBYPASSRLS`, exact minimum grants, no child-table grants, account/owner isolation, concurrent deletes, identity cleanup, and cascade proof for flow nodes/runs/events. Synthetic-only data, `--network none`, tmpfs, read-only mounts, generated credentials, and no residual containers. Evidence: `../validation-postgres-flow-delete-14d009222b.log`.
- No route wiring, Supabase/Auth migration, provider call, real data/credentials, app traffic, production, commit, push, or deploy. Keep task in progress; H-DATA-003/H-DB-003 remain unapproved overall.

## Independent read-only review

- Independent GPT-6 Luna read-only review returned exact `APPROVE`, zero findings, and zero caveats for this slice only.
- This approval does not cover route wiring, H-DATA-003/H-DB-003 overall, Auth/session migration, Supabase replacement, Storage, Realtime, application traffic, or production. Task remains `in_progress`.
