# Implementer handoff — PostgreSQL template sync persistence

## Start state

- Task `20261020-034647-d1e1`, status `in_progress`, H-DATA-003 phase 03.
- Repository `C:\Sistemas\wacrm`; branch `main`; expected HEAD `7db4abf47dbc94a732f3ab67ac4d53ba660c9a2c`.
- Preserve dirty and untracked work. Use task-owned synthetic PostgreSQL in Docker Desktop only; never use Supabase.
- No commit, push, deploy, reset, clean, rebase, or branch change.

## Scope

Add an unwired server-only PostgreSQL repository that atomically upserts one template-sync snapshot. Require verified admin membership, explicit account predicates, transaction-local RLS identity, parameterized values, creator consistency, same-key advisory locking, and fail-closed duplicate/input/row checks. Preserve the existing update behavior that leaves `header_media_url` untouched and relies on the database trigger to set `updated_at` on update.

No route/UI wiring, provider calls, network traffic, Auth/session replacement, schema/grant/RLS edits, Supabase, real credentials/data, app traffic, or production. Writes only to task-owned synthetic Docker data.

## Validation and review

Start with red focused Vitest. Run focused tests, typecheck, targeted zero-warning ESLint, Prettier, PowerShell AST/fixture checks, `git diff --check`, and forced-RLS integration in disposable Docker Desktop PostgreSQL 16 with `NOBYPASSRLS`, exact minimum column grants, `--network none`, tmpfs, read-only mounts, synthetic fixtures/generated credentials, concurrency proof, and cleanup verification. Obtain a fresh independent GPT-6 Luna read-only review; remediate until exact `APPROVE`, zero findings/caveats. Keep task `in_progress`; H-DATA-003/H-DB-003 remain unapproved overall.

## Implementation and validation

- TDD RED confirmed the missing module; focused Vitest passes 17/17.
- The unwired repository validates snapshots and performs one transaction-scoped, advisory-locked upsert for the verified account, matching only rows with a consistent creator profile/account. It returns only UUID/action and preserves `header_media_url` on updates.
- TypeScript, targeted zero-warning ESLint, Prettier, PowerShell AST/fixture validation, and `git diff --check` passed.
- Docker Desktop PostgreSQL 16 forced-RLS integration passed with exact minimum SELECT/INSERT/UPDATE column grants, runtime `NOBYPASSRLS`, generated synthetic data/credentials, account and creator isolation, constraint rollback, duplicate fail-closed behavior, concurrent serialization, media preservation, trigger timestamps, transaction-local identity cleanup, and cleanup verification. Final evidence: `../validation-postgres-template-sync-persistence-264fd1579d.log`. The prior runner's unsupported `min(uuid)` post-probe was corrected and rerun successfully; its log is retained at `../validation-postgres-template-sync-persistence-a45aa793b7.log`.
- No route/UI wiring, provider/network calls, Supabase, real credentials/data, app traffic, production, commit, push, or deploy.

## Independent review

Fresh independent GPT-6 Luna read-only review returned exact `APPROVE`, with zero findings and zero caveats. Approval remains limited to this repository slice.

## Next action

Next task `20261020-035839-2f1e` isolates template-submit result persistence and preserves per-user conflict semantics. Keep this task in progress and all route consumers unwired.
