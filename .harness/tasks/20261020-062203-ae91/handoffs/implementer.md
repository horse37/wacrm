# Implementer handoff — PostgreSQL automation creation

## Start state

- Task `20261020-062203-ae91`, status `in_progress`, H-DATA-003 phase 03.
- Repository `C:\Sistemas\wacrm`; branch `main`; expected HEAD `7db4abf47dbc94a732f3ab67ac4d53ba660c9a2c`.
- Preserve all dirty and untracked work. PostgreSQL in disposable Docker Desktop only; never Supabase.
- No commit, push, deploy, reset, clean, rebase, or branch change.

## Scope

Implement an unwired server-only PostgreSQL repository to create automation rows and nested or legacy-flat steps atomically for the verified account. Keep drafts permissive, validate before persisting active automations with the existing pure validators, generate database IDs, and roll back parent/steps together. Template resolution and route/UI wiring stay outside this slice.

## Validation

TDD RED confirmed the module was absent. Repository/account-guard Vitest passed 20/20, TypeScript passed, targeted ESLint passed with zero warnings, Prettier and `git diff --check` passed. Forced-RLS PostgreSQL 16 Docker integration passed; evidence: `.harness/tasks/20261020-062203-ae91/validation-postgres-automation-create-916bbb7dbb.log`. It includes nested/flat step persistence, active validation, draft defaults, rollback, exact grants, NOBYPASSRLS, same-backend identity cleanup, and resource cleanup.

Independent GPT-6 Luna read-only review returned exact `APPROVE`, zero findings, and zero caveats for this repository slice only; see `.harness/tasks/20261020-062203-ae91/review-post-implementation-20261020.md`. Continue with a separate automation-update persistence task; keep task `in_progress`, route/UI unwired, and H-DATA-003/H-DB-003 unapproved overall.

## Restrictions

No Supabase, route/UI wiring, Auth/session provider work, template catalog changes, update/delete/duplicate behavior, engine/cron changes, permanent schema/grant/RLS changes, real credentials/data, traffic, production, commit, push, deploy, reset, clean, rebase, or branch change. Keep task and H-DATA-003/H-DB-003 unapproved overall.
