# Implementer handoff — PostgreSQL automation update

## Start state

- Task `20261020-064000-9c8d`, status `in_progress`, H-DATA-003 phase 03.
- Repository `C:\Sistemas\wacrm`; branch `main`; expected HEAD `7db4abf47dbc94a732f3ab67ac4d53ba660c9a2c`.
- Preserve all dirty and untracked work. Use disposable PostgreSQL in Docker Desktop only; never Supabase.
- No commit, push, deploy, reset, clean, rebase, or branch change.

## Scope

Implement a server-only, unwired repository for PATCHing verified-account automations. Match the existing allowlist and partial-update semantics; optionally replace nested builder steps using fresh database IDs; validate the merged state when it remains active; perform parent and child writes atomically.

## Validation

TDD RED confirmed the repository module was absent. Focused repository/account-guard Vitest passed 18/18, including stored-step cycle cases; TypeScript, targeted zero-warning ESLint, Prettier, PowerShell AST/fixture, and `git diff --check` passed. Final PostgreSQL 16 Docker Desktop evidence is `.harness/tasks/20261020-064000-9c8d/validation-postgres-automation-update-2791468aed.log`. Forced RLS, `NOBYPASSRLS`, exact grants, isolation, active/draft validation, tree replacement, atomic rollback including pending FK state, same-backend identity cleanup, and no residual Docker resources passed with synthetic fixtures and generated credentials.

Initial independent GPT-6 Luna review found one medium item: stored-step graph traversal lacked an explicit visited-node check. The implementation now rejects repeated nodes and has unit cases for self-reference and a two-step cycle. Focused checks and Docker PostgreSQL validation were rerun; independent read-only rereview returned exact `APPROVE`, zero findings, and zero caveats for this slice. Records: `.harness/tasks/20261020-064000-9c8d/review-initial-20261020.md` and `.harness/tasks/20261020-064000-9c8d/review-post-remediation-20261020.md`. Keep route/UI unwired, task `in_progress`, and H-DATA-003/H-DB-003 unapproved overall.

## Restrictions

No route/UI wiring, Supabase, Auth/session provider work, engine/cron changes, permanent schema/grant/RLS changes, real credentials/data, app traffic, production, commit, push, deploy, reset, clean, rebase, or branch change. This slice has independent approval only; keep the HARNESS task and H-DATA-003/H-DB-003 unapproved overall.
