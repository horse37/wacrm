# Implementer handoff — PostgreSQL message-reaction target context

## Start state

- Task `20261020-045346-9a2d`, status `in_progress`, H-DATA-003 phase 03.
- Repository `C:\Sistemas\wacrm`; branch `main`; expected HEAD `7db4abf47dbc94a732f3ab67ac4d53ba660c9a2c`.
- Preserve all dirty/untracked work. Docker Desktop PostgreSQL only; never Supabase.
- No commit, push, deploy, reset, clean, rebase, or branch change.

## Scope

Add an unwired server-only repository that, for a verified agent account member, resolves the external provider message ID and contact phone associated with an internal message ID. Enforce account, conversation, contact, and creator consistency with parameterized SQL and transaction-local RLS identity. Keep provider calls and route changes out of scope.

## Validation

Start with a failing focused Vitest. Run focused Vitest, TypeScript, targeted ESLint with zero warnings, Prettier, PowerShell AST/fixture checks, `git diff --check`, and a disposable Docker Desktop PostgreSQL 16 forced-RLS integration with `NOBYPASSRLS`, minimum column grants, synthetic data/generated credentials, `--network none`, tmpfs, read-only mounts, and cleanup verification. Obtain fresh independent GPT-6 Luna read-only review; remediate and repeat until exact `APPROVE` with zero findings/caveats.

## Next action

Inspect and scope the next isolated PostgreSQL-backed message-reaction slice. Keep the route unwired.

## Implementation and validation

- TDD RED confirmed the repository was absent; focused Vitest passed 11/11. TypeScript, targeted zero-warning ESLint, Prettier, and `git diff --check` passed.
- Added the unwired account-scoped target lookup with verified agent authorization, transaction-local identity, parameterized account/message predicates, creator/contact account consistency, safe unsent and missing-phone handling, and a minimal DTO.
- Docker Desktop PostgreSQL 16 integration passed forced RLS, `NOBYPASSRLS`, exact minimum column grants, no table-level grants, cross-account and creator mismatch isolation, unsent/missing-phone checks, and identity cleanup. Synthetic data only, `--network none`, tmpfs, read-only mounts, generated credentials, and no residual resources. Evidence: `../validation-postgres-message-reaction-target-fbb51f4027.log`.
- Independent GPT-6 Luna read-only review returned exact `APPROVE`, zero findings, and zero caveats, limited to this target-context repository. This does not approve route/provider behavior or H-DATA-003/H-DB-003 overall.
- No route/provider call, Supabase, real data/credentials, traffic, production, commit, push, or deploy. Keep task `in_progress`; H-DATA-003/H-DB-003 remain unapproved overall.
