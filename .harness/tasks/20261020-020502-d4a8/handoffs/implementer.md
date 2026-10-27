# Implementer handoff — PostgreSQL flow editor load

## Start state

- Task `20261020-020502-d4a8`, status `in_progress`, H-DATA-003 phase 03.
- Repository `C:\Sistemas\wacrm`; branch `main`; expected HEAD `7db4abf47dbc94a732f3ab67ac4d53ba660c9a2c`.
- Preserve all existing dirty/untracked work. PostgreSQL in disposable Docker Desktop only; never use Supabase.
- No commit, push, deploy, reset, clean, rebase, or branch change.

## Scope

Implement only a server-only read repository for one flow and the editor's node fields. Existing migration 017 permits account-member reads, so allow any verified account member; validate UUID, set transaction-local identity, explicitly constrain flow and nodes by verified account, and enforce creator-profile/account consistency. Validate minimal output and order nodes by `created_at`, UUID. Keep route and page unwired.

No writes, flow runs/events, Auth/session replacement, schema/grant/RLS changes, Supabase, real credentials/data, app traffic, or production.

## Validation and review

Write focused red tests first. Run repository/account-guard Vitest, TypeScript, zero-warning ESLint, Prettier, PowerShell AST/fixture checks, `git diff --check`, and PostgreSQL 16 forced-RLS integration in Docker Desktop with `NOBYPASSRLS`, minimum column grants, `--network none`, tmpfs, read-only mounts, synthetic credentials, no ports/named volumes, and cleanup assertion. Obtain fresh independent GPT-6 Luna read-only review; remediate and repeat until `APPROVE`, zero findings, zero caveats. Keep task `in_progress`; H-DATA-003/H-DB-003 remain unapproved.

## Worktree validation

- TDD RED confirmed the module was absent. Flow-editor plus account-guard tests passed 20/20; TypeScript, zero-warning targeted ESLint, Prettier for supported files, PowerShell AST/forced-RLS fixture checks, and `git diff --check` passed.
- Docker Desktop PostgreSQL 16 forced-RLS integration passed with `NOBYPASSRLS`, exact column grants, account-member isolation, creator-profile consistency, stable node order, minimal editor DTO, and pooled identity cleanup. Network was `none`; database used tmpfs; repository mounts were read-only; generated synthetic credentials were not logged; no ports/named volumes/residual containers. Evidence: `validation-postgres-flow-editor-load-df54197bc5.log`.
- Fresh independent GPT-6 Luna read-only review returned `APPROVE`, zero findings, and zero caveats for this slice. The first P2 about the previous pool snapshot was withdrawn after the initial dirty baseline was confirmed. No route/page consumers were wired. Task remains `in_progress`; H-DATA-003/H-DB-003 remain unapproved.

Next: continue with a separate narrow PostgreSQL repository slice; keep consumers unwired and use only disposable Docker Desktop PostgreSQL.
