# Implementer handoff — PostgreSQL flow list

## Start state

- Task `20261020-015908-49b2`, status `in_progress`, H-DATA-003 phase 03.
- Repository root `C:\Sistemas\wacrm`; branch `main`; expected HEAD `7db4abf47dbc94a732f3ab67ac4d53ba660c9a2c`.
- Preserve dirty/untracked work. Use disposable PostgreSQL in Docker Desktop only; never use Supabase.
- No commit, push, deploy, reset, clean, rebase, or branch change.

## Scope

Implement only a server-only read repository for the existing flow-list screen fields. Require verified account context, transaction-local identity, account and creator-profile consistency, allowlisted fields, runtime validation, and stable newest-first ordering. Keep API route and page unwired.

No flow/node writes, runtime runs/events, Auth/session replacement, schema/grant/RLS changes, Supabase, real data, traffic, or production.

## Validation and review

Write focused tests first and observe the expected failure. Run focused repository/account-guard Vitest, TypeScript, zero-warning targeted ESLint, Prettier, PowerShell AST/fixture checks, `git diff --check`, and forced-RLS PostgreSQL 16 integration in Docker Desktop with `NOBYPASSRLS`, minimum column grants, `--network none`, tmpfs, read-only mounts, generated synthetic passwords, no ports/named volumes, and cleanup assertion. Obtain fresh independent GPT-6 Luna read-only review; remediate and repeat affected checks/review until `APPROVE` with zero findings/caveats. Keep task in progress and do not claim H-DATA-003/H-DB-003 approval.

## Worktree status

Implemented `src/lib/repositories/flow-list.ts`. Focused repository/account-guard tests passed 19/19; TypeScript, zero-warning ESLint, Prettier, PowerShell AST/fixture checks, and `git diff --check` passed. Docker Desktop PostgreSQL 16 forced-RLS integration passed with exact column SELECT grants, no writes, creator/account isolation, owner/agent/viewer account access, deterministic ordering, readonly mounts, `--network none`, tmpfs, and cleanup assertion. Final log: `validation-postgres-flow-list-19d4c7bc9e.log`.

Fresh independent GPT-6 Luna read-only review returned exactly `APPROVE`, zero findings, and zero caveats, limited to this repository slice. Keep task `in_progress`, consumers unwired, and H-DATA-003/H-DB-003 unapproved overall; continue via a separate narrow repository task.
