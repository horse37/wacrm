# Implementer handoff — PostgreSQL account invitation POST route

## Start state

- Task `20261020-155609-cc4b`, `postgres-account-invitation-post-route`, status `in_progress`.
- Repository `C:\Sistemas\wacrm`; branch `main`; HEAD `7db4abf47dbc94a732f3ab67ac4d53ba660c9a2c`.
- Preserve all existing dirty work. Do not reset, restore, clean, switch branches, commit, push, or deploy.
- PostgreSQL must run only in disposable Docker Desktop resources with synthetic data.

## Scope

Migrate only POST `/api/account/invitations`; keep the approved GET behavior unchanged. Validate existing repository `create` with a forced-RLS Docker fixture before wiring it.

## Next action

Implementation and focused validation are complete. POST uses the existing PostgreSQL invitations repository; focused route/repository tests pass 15/15, TypeScript passes, targeted ESLint has zero warnings, Prettier passes, and disposable PostgreSQL 16 forced-RLS integration passes. Docker evidence: `validation-postgres-account-invitation-create-0971f41ffa.log`.

Independent GPT-6 Luna read-only review returned exact `APPROVE`, zero findings, and zero caveats for this POST route slice; report: `review-gpt6-luna-final-20261020.md`. Approval is limited to the POST route and task-local evidence. Keep the HARNESS task `in_progress`; this does not approve H-DB-003/H-DATA-003 overall.

Next: continue with the next narrowly scoped H-DATA-003 PostgreSQL slice, using only disposable PostgreSQL in Docker Desktop. Preserve existing local changes and keep Supabase, real credentials/data, traffic, production, commit, push, and deploy out of scope.

## Limits

No Supabase service access, real credentials/data, permanent grants/policies, application traffic, production, or broad H-DB-003/H-DATA-003 approval.
