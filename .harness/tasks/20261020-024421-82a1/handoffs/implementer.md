# Implementer handoff — PostgreSQL approved broadcast-template read

## Start state

- Task `20261020-024421-82a1`, status `in_progress`, H-DATA-003 phase 03.
- Repository `C:\Sistemas\wacrm`; branch `main`; expected HEAD `7db4abf47dbc94a732f3ab67ac4d53ba660c9a2c`.
- Preserve preexisting dirty/untracked files. Use disposable Docker Desktop PostgreSQL only; do not use Supabase.
- No commit, push, deploy, reset, clean, rebase, or branch change.

## Scope

Implement one unwired server-only read repository for approved message-template cards in the broadcast composer. Require verified account context, transaction-local `auth.uid()`, explicit account scope, and creator-profile/account consistency. Return only validated `id`, `name`, `category`, nullable `language`, and `body_text`; preserve unbounded newest-first order.

Do not wire UI/API, migrate settings/inbox template consumers, write rows, call Meta, change Auth/session, schema/grants/RLS, use Supabase, or access real data/credentials, application traffic, or production.

## Validation and review

Start with failing focused Vitest. Run focused Vitest, TypeScript, targeted zero-warning ESLint, Prettier, PowerShell AST/fixture checks, `git diff --check`, and disposable Docker PostgreSQL 16 forced-RLS integration with runtime `NOBYPASSRLS`, minimum column SELECT grants, `--network none`, tmpfs, read-only mounts, synthetic data/credentials, and cleanup assertion. Obtain fresh independent GPT-6 Luna read-only review; remediate minimally and repeat affected checks/review until `APPROVE`, zero findings, and zero caveats. Keep task `in_progress`; H-DATA-003/H-DB-003 stay unapproved overall.

## Next action

Implementation, focused validation, and independent review are complete. TDD RED confirmed module absence; focused Vitest passed 10/10, typecheck, targeted ESLint with zero warnings, Prettier, PowerShell AST/fixture forced-RLS and minimum-grant checks, and `git diff --check` passed. Final disposable Docker Desktop PostgreSQL 16 forced-RLS integration passed; evidence: `validation-postgres-approved-template-172e15f932.log`. Independent GPT-6 Luna read-only review returned `APPROVE`, zero findings, and zero caveats for this slice only. Next: separate template-manager catalog read; keep task `in_progress` and consumers unwired.

## Worktree validation

- Added a server-only account-scoped read for approved broadcast templates, requiring a matching creator profile and returning only validated card fields. Order remains unbounded, newest first, UUID tie-break.
- Focused Vitest passed 10/10. TypeScript, targeted zero-warning ESLint, Prettier, PowerShell AST/fixture checks, and `git diff --check` passed.
- Docker Desktop PostgreSQL 16 integration passed with runtime `NOBYPASSRLS`, forced RLS, minimum column SELECT grants, account/creator isolation, owner/agent/viewer access, approved-only filter/order, minimal DTO, `--network none`, tmpfs, read-only mounts, generated credentials, and cleanup. Evidence: `validation-postgres-approved-template-172e15f932.log`.
- No UI/API consumer wiring, settings/inbox migration, Meta calls, Supabase, Auth/session, schema/grant/RLS changes, real data/credentials, traffic, production, commit, push, or deploy. H-DATA-003/H-DB-003 remain unapproved overall.

## Independent review

Fresh independent GPT-6 Luna read-only review returned exactly `APPROVE`, zero actionable findings, and zero caveats, limited to the approved-broadcast-template repository slice. H-DATA-003/H-DB-003 remain unapproved overall.
