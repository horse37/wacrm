# Implementer handoff — PostgreSQL template delete persistence

## Start state

- Task `20261020-043521-9f8c`, status `in_progress`, H-DATA-003 phase 03.
- Repository `C:\Sistemas\wacrm`; branch `main`; expected HEAD `7db4abf47dbc94a732f3ab67ac4d53ba660c9a2c`.
- Preserve all dirty/untracked work. Use task-owned synthetic PostgreSQL in Docker Desktop only; never Supabase.
- No commit, push, deploy, reset, clean, rebase, or branch change.

## Scope

Add an unwired server-only repository for the local deletion in the template lifecycle DELETE handler. Require verified admin membership, UUID validation, transaction-local identity, account scoping, creator-account consistency, parameterized SQL, and fail-closed returned-row checks. Do not call Meta or wire the route.

## Validation

- Begin with a failing focused Vitest. Then run focused tests, TypeScript, targeted zero-warning ESLint, Prettier, PowerShell AST/fixture checks, and `git diff --check`.
- Prove the actual repository against disposable Docker Desktop PostgreSQL 16 with forced RLS, `NOBYPASSRLS`, exact minimum privileges, synthetic-only fixtures, `--network none`, tmpfs, read-only mounts, generated credentials, and no residual resources.
- Obtain independent GPT-6 Luna read-only review. Remediate and repeat affected checks until exact `APPROVE`, zero findings, and zero caveats; approval applies only to this repository slice.

## Implementation and validation

- TDD RED confirmed the repository module was absent; focused Vitest passed 8/8. TypeScript and targeted ESLint with `--max-warnings=0` passed.
- Added the unwired server-only delete repository with verified admin membership, UUID validation, transaction-local RLS identity, explicit account/creator scope, parameterized SQL, and fail-closed return checks.
- Disposable Docker Desktop PostgreSQL 16 integration passed forced RLS, `NOBYPASSRLS`, exact minimum grants, admin/owner authorization, account and creator isolation, cross-account/missing behavior, concurrent delete behavior, identity cleanup, and resource cleanup. Synthetic data only; Docker `--network none`, tmpfs, read-only mounts, and generated credentials. Evidence: `../validation-postgres-template-delete-persistence-814bca45cf.log`.
- PowerShell AST and fixture checks passed in the integration runner; Prettier check passed for changed formatted sources/records, and `git diff --check` passed.
- Fresh independent GPT-6 Luna read-only review returned exact `APPROVE`, zero findings, and zero caveats, limited to this repository slice. Reviewer made no edits; evidence is recorded in the final validation log.
- Route unwired; no Meta/provider call, Supabase, real data, application traffic, production, commit, push, or deploy. Approval is limited to this slice; H-DATA-003/H-DB-003 remain open.

## Next action

Proceed to `postgres-message-reaction-persistence`: isolate the user-authenticated local agent-reaction mirror with account authorization. Keep the route unwired and do not send provider reactions; use Docker Desktop PostgreSQL only and never Supabase.
