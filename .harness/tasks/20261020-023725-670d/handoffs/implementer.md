# Implementer handoff — PostgreSQL broadcast-detail read

## Start state

- Task `20261020-023725-670d`, status `in_progress`, H-DATA-003 phase 03.
- Repository `C:\Sistemas\wacrm`; branch `main`; expected HEAD `7db4abf47dbc94a732f3ab67ac4d53ba660c9a2c`.
- Preserve pre-existing dirty/untracked work. Use task-owned disposable Docker Desktop PostgreSQL only; never use Supabase.
- No commit, push, deploy, reset, clean, rebase, or branch change.

## Scope

Implement only an unwired server-side read repository for one broadcast's detail header and complete recipient list. Require a verified account, transaction-local identity, explicit same-account parent scope, same-account author profile, and same-account contact join. Return a minimal validated DTO; preserve null contacts and stable newest-first history.

No page/API wiring, sends/deletes/updates, polling, Auth/session replacement, repository schema/grant/RLS edits, Supabase, real credentials/data, application traffic, or production.

## Validation and review

Start with TDD RED. Run focused Vitest, TypeScript, targeted zero-warning ESLint, Prettier, PowerShell AST/fixture checks, `git diff --check`, and disposable PostgreSQL 16 forced-RLS integration with `NOBYPASSRLS`, exact minimum grants, `--network none`, tmpfs, read-only mounts, synthetic credentials/data, and cleanup verification. Obtain fresh independent GPT-6 Luna read-only review; remediate and repeat affected checks/review until `APPROVE`, zero findings, and zero caveats. Keep task `in_progress`; H-DATA-003/H-DB-003 stay unapproved overall.

## Worktree validation

- TDD RED confirmed module absence. Vitest passed 17/17; TypeScript, zero-warning targeted ESLint, Prettier, PowerShell AST/fixture checks, and `git diff --check` passed.
- First Docker fixture setup stopped before integration due to a duplicate synthetic profile UUID; corrected seed passed final forced-RLS PostgreSQL 16 integration with `NOBYPASSRLS`, exact column SELECT grants, synthetic account/creator/contact isolation, stable full recipient order, null contacts, UTC timestamps, safe DTO, `--network none`, tmpfs, read-only mounts, generated credentials, and no residual resources. Evidence: `validation-postgres-broadcast-detail-cd3ec5357a.log`.
- Consumers remain unwired; no Supabase, writes, Auth/session replacement, schema/grant/RLS changes, real data/credentials, traffic, production, commit, push, or deploy. H-DATA-003/H-DB-003 remain unapproved overall.

## Independent review and next action

Fresh independent GPT-6 Luna read-only review returned exactly `APPROVE`, zero actionable findings, and zero caveats, limited to this broadcast-detail repository slice. Keep this task `in_progress`; H-DATA-003/H-DB-003 remain unapproved overall. Continue with a separate approved-broadcast-template read repository slice.
