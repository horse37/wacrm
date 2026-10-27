# Implementer handoff — PostgreSQL template sync match lookup

## Start state

- Task `20261020-033829-58ee`, status `in_progress`, H-DATA-003 phase 03.
- Repository `C:\Sistemas\wacrm`; branch `main`; expected HEAD `7db4abf47dbc94a732f3ab67ac4d53ba660c9a2c`.
- Preserve dirty and untracked work. Use disposable PostgreSQL in Docker Desktop only; never use Supabase.
- Do not commit, push, deploy, reset, clean, rebase, or change branches.

## Scope

Add an unwired server-only repository lookup for the exact account/name/language match used by template sync. It returns only a validated template ID or null. Require verified account membership, an explicit account predicate, transaction-local RLS identity, parameterized values, creator profile/account consistency, and fail-closed duplicate/shape validation.

No route/UI wiring, writes, Meta/provider calls, Auth/session replacement, schema/grant/RLS edits, Supabase, real credentials/data, application traffic, or production.

## Validation and review

Start with red focused Vitest. Run focused Vitest, typecheck, targeted zero-warning ESLint, Prettier, PowerShell AST/fixture checks, `git diff --check`, and forced-RLS integration in disposable Docker Desktop PostgreSQL 16 with `NOBYPASSRLS`, exact minimum column grants, `--network none`, tmpfs, read-only mounts, synthetic fixtures/generated credentials, and cleanup verification. Get fresh independent GPT-6 Luna read-only review; remediate and repeat until exact `APPROVE` with zero findings/caveats. Keep task `in_progress`; H-DATA-003/H-DB-003 remain unapproved overall.

## Implementation and validation

- TDD RED confirmed the module was absent; focused Vitest passes 9/9.
- Added the unwired minimal ID lookup with exact account/name/language matching, verified account scope, creator consistency, transaction-local identity, and fail-closed duplicate/shape handling.
- TypeScript, targeted zero-warning ESLint, Prettier for changed source/test/integration/task files, PowerShell AST/fixture checks, and `git diff --check` passed.
- Disposable Docker Desktop PostgreSQL 16 forced-RLS integration passed with runtime `NOBYPASSRLS`, exact minimum grants, account/creator isolation, missing/orphan/duplicate cases, `--network none`, tmpfs, read-only mounts, synthetic fixtures, and cleanup. Evidence: `validation-postgres-template-sync-match-dcbdd8c769.log`.
- No route/UI wiring, writes, provider calls, Supabase, real data/credentials, application traffic, production, commit, push, or deploy.

## Next action

Fresh independent GPT-6 Luna read-only review returned exact `APPROVE`, zero findings, zero caveats, and no additional validation needed, limited to this repository slice. Next task `20261020-034647-d1e1` isolates sync-result persistence in a separate PostgreSQL repository. Keep the sync route unwired, this task `in_progress`, and H-DATA-003/H-DB-003 unapproved overall.
