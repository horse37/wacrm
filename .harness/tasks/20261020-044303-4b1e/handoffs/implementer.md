# Implementer handoff — PostgreSQL message-reaction persistence

## Start state

- Task `20261020-044303-4b1e`, status `in_progress`, H-DATA-003 phase 03.
- Repository `C:\Sistemas\wacrm`; branch `main`; expected HEAD `7db4abf47dbc94a732f3ab67ac4d53ba660c9a2c`.
- Preserve every dirty/untracked file. Use task-owned synthetic PostgreSQL in Docker Desktop only; never Supabase.
- No commit, push, deploy, reset, clean, rebase, or branch change.

## Scope

Isolate only the local message-reaction persistence after the existing provider call. Require verified account membership with agent role, transaction-local RLS identity, message/conversation account scoping, creator consistency, actor-owned delete semantics, and parameterized upsert/delete. Do not wire the route or send provider reactions.

## Validation

- Start with a failing focused Vitest; then run focused tests, TypeScript, targeted zero-warning ESLint, Prettier, PowerShell AST/fixture checks, and `git diff --check`.
- Prove actual persistence in disposable Docker Desktop PostgreSQL 16 with forced RLS, `NOBYPASSRLS`, exact minimum grants, synthetic-only fixtures, `--network none`, tmpfs, read-only mounts, generated credentials, concurrency, and no residual resources.
- Obtain a fresh independent GPT-6 Luna read-only review; remediate and repeat until exact `APPROVE`, zero findings, and zero caveats. Any approval covers this repository slice only.

## Next action

Inspect and scope the next isolated PostgreSQL repository slice. Keep the reaction route unwired and do not send provider reactions.

## Implementation and validation

- TDD RED confirmed the repository was absent; focused Vitest passed 10/10. TypeScript and targeted zero-warning ESLint passed.
- Added the unwired repository with verified agent-level account membership, transaction-local RLS identity, message/conversation/account and creator checks, session-derived agent actor, unique-key upsert, and actor-only delete.
- Final disposable PostgreSQL 16 integration passed forced RLS, NOBYPASSRLS, exact minimum grants, account isolation, provider-ID guard, replacement/concurrent upserts, idempotent actor delete, customer-reaction preservation, pooled identity cleanup, and container cleanup. Synthetic data only; Docker `--network none`, tmpfs, read-only mounts, and generated credentials. Evidence: `../validation-postgres-message-reaction-persistence-aaa6561efc.log`.
- Initial missing-grant failures and the corrected rerun remain in adjacent task logs. PowerShell AST and fixture checks passed in the final runner. Prettier check and `git diff --check` passed after the evidence update.
- Independent GPT-6 Luna read-only review returned exact `APPROVE`, zero findings, and zero caveats, limited to this unwired persistence repository. This does not approve route wiring or H-DATA-003/H-DB-003 overall.
- Route remains unwired; no provider call, Supabase, real data, application traffic, production, commit, push, or deploy. Any approval is limited to this slice; H-DATA-003/H-DB-003 remain open.
