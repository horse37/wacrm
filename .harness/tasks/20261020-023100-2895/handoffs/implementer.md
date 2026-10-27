# Implementer handoff — PostgreSQL broadcast-list read

## Start state

- Task `20261020-023100-2895`, status `in_progress`, H-DATA-003 phase 03.
- Repository `C:\Sistemas\wacrm`; branch `main`; expected HEAD `7db4abf47dbc94a732f3ab67ac4d53ba660c9a2c`.
- Preserve pre-existing dirty/untracked work. Use task-owned disposable Docker Desktop PostgreSQL only; never use Supabase.
- No commit, push, deploy, reset, clean, rebase, or branch change.

## Scope

Implement only an unwired server-side list-read repository for broadcasts. Require a verified account, set transaction-local identity, use explicit account scope, and verify author-profile account consistency. Return a validated minimal broadcast-card DTO and preserve complete newest-first list behavior with stable tie ordering.

No route/page wiring, writes/sends, status changes, Auth/session replacement, repository schema/grant/RLS edits, Supabase, real data/credentials, application traffic, or production.

## Validation and review

Use TDD RED first. Run focused Vitest, TypeScript, targeted zero-warning ESLint, Prettier, PowerShell AST/fixture checks, `git diff --check`, and disposable PostgreSQL 16 forced-RLS integration with `NOBYPASSRLS`, exact minimum grants, `--network none`, tmpfs, read-only mounts, synthetic credentials/data, and cleanup verification. Obtain fresh independent GPT-6 Luna read-only review; remediate and repeat affected checks/review until `APPROVE`, zero findings, and zero caveats. Keep task `in_progress`; H-DATA-003/H-DB-003 stay unapproved overall.

## Worktree validation

- TDD RED confirmed the module was absent. Vitest passed 11/11; TypeScript, zero-warning targeted ESLint, Prettier, PowerShell AST/fixture checks, and `git diff --check` passed.
- Disposable Docker Desktop PostgreSQL 16 forced-RLS integration passed with `NOBYPASSRLS`, exact column SELECT grants, synthetic account/creator isolation, stable unbounded ordering, UTC timestamps, safe DTO, `--network none`, tmpfs, read-only mounts, generated credentials, and no residual resources. Evidence: `validation-postgres-broadcast-list-287c1f3540.log`.
- Consumers remain unwired. No Supabase, writes/sends, Auth/session replacement, schema/grant/RLS changes, real data/credentials, traffic, production, commit, push, or deploy. H-DATA-003/H-DB-003 remain unapproved overall.

## Next action

Fresh independent GPT-6 Luna read-only review returned `APPROVE`, zero findings, and zero caveats, limited to this slice. Continue with the separate broadcast-detail/recipient read slice; keep consumers unwired and H-DATA-003/H-DB-003 unapproved overall.
