# Implementer handoff — PostgreSQL automation duplication

## Start state

- Task `20261020-060824-e5d4`, status `in_progress`, H-DATA-003 phase 03.
- Repository `C:\Sistemas\wacrm`; branch `main`; expected HEAD `7db4abf47dbc94a732f3ab67ac4d53ba660c9a2c`.
- Preserve all dirty and untracked work. PostgreSQL in disposable Docker Desktop only; never Supabase.
- No commit, push, deploy, reset, clean, rebase, or branch change.

## Scope

Add an unwired server-only PostgreSQL repository for duplicating an automation owned by the verified user in the verified account. Copy its descriptive/trigger fields into an inactive automation, reset execution metadata, and copy steps with fresh IDs and valid remapped parents in one `REPEATABLE READ` transaction. Avoid `UPDATE` grants solely for source locking. No route/UI wiring or permanent schema/grant/RLS changes.

## Implementation checkpoint

The repository, unit tests, synthetic PostgreSQL fixture, integration probes, and Docker Desktop validator are implemented. Source and step reads use `REPEATABLE READ`; runtime privileges stay read/insert only. Final focused checks passed (repository/account-guard 17/17, TypeScript, zero-warning ESLint, Prettier, diff check). Final Docker evidence: `.harness/tasks/20261020-060824-e5d4/validation-postgres-automation-duplicate-c9d4c366de.log`. The initial lock/grant failure is preserved in `.harness/tasks/20261020-060824-e5d4/validation-postgres-automation-duplicate-c9780d4a5a.log` and was corrected.

## Validation

Independent GPT-6 Luna read-only review returned exact `APPROVE`, zero findings, and zero caveats for this repository slice only; see `.harness/tasks/20261020-060824-e5d4/review-post-implementation-20261020.md`. Continue with the separate automation-creation persistence task; keep this task `in_progress`, route/UI unwired, and H-DATA-003/H-DB-003 unapproved overall.

## Restrictions

No Supabase, route wiring, Auth/session provider work, engine/cron work, permanent schema/grant/RLS changes, real data/credentials, traffic, production, commit, push, or deploy. Keep the task and H-DATA-003/H-DB-003 unapproved overall.
