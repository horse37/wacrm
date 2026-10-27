# Implementer handoff — pending-claim tenant scope

## Start state

- Task `20261020-123450-7a32`; repo `C:\Sistemas\wacrm`; branch `main`; HEAD `7db4abf47dbc94a732f3ab67ac4d53ba660c9a2c`.
- Preserve all existing local work. No reset, restore, clean, rebase, branch change, commit, push, or deploy.
- Use Docker Desktop with task-owned disposable PostgreSQL 16, synthetic rows and generated credentials. No Supabase, VPS, production, real data, or app traffic.

## Objective and boundary

Require trusted `{ userId, accountId }` actor context and claim only due rows within that account. Preserve row `user_id` as execution owner so one tenant worker can resume multiple account members' waits. Validate the query under forced RLS and minimum test grants. Keep claim orchestration and engine/cron unwired; make no permanent schema, role, grant, pool, Auth/session, or runtime changes.

## Validation

TDD RED; focused Vitest; TypeScript; zero-warning targeted ESLint; targeted Prettier; PowerShell AST/fixture; existing pending-claim Docker proof; new tenant/RLS Docker proof; `git diff --check`; independent GPT-6 Luna review to exact `APPROVE` with zero findings/caveats.

## Next

Implementation and focused validation are complete. Independent read-only GPT-6 Luna review returned **APPROVE**, zero findings and zero caveats; see `../review-gpt6-luna-20261020.md`. Approval covers this task diff only. Keep H-DATA-003/H-DB-003 unapproved overall. Next: inspect remaining H-DATA-003 work and define the next narrow HARNESS task.

- Vitest 17/17, TypeScript, zero-warning targeted ESLint, Prettier, PowerShell AST/fixture, and `git diff --check` passed.
- Existing claim integration: `C:\Sistemas\wacrm\.harness\tasks\20261020-074348-a853\validation-postgres-automation-pending-claim-3537349ee6.log`.
- Tenant/RLS integration: `C:\Sistemas\wacrm\.harness\tasks\20261020-123450-7a32\validation-postgres-automation-pending-claim-tenant-82ade65185.log`; Docker cleanup found no remaining task containers.
- No engine/cron, permanent schema/RLS/grants/roles, pool/Auth/session wiring, Supabase, production, commit, push, or deploy.
