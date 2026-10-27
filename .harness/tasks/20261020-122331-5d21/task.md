# Task — PostgreSQL automation pending-finalize tenant scope

- id: `20261020-122331-5d21`
- type: `migration`
- slug: `postgres-automation-pending-finalize-tenant-scope`
- roadmap: H-DATA-003, phase 03
- status: `in_progress`

## Goal

Require trusted tenant/owner context when finalizing a scheduled automation wait and prove the terminal update under disposable PostgreSQL 16 tenant RLS.

## Context

The pending-finalize repository is an unwired persistence primitive. It currently updates by execution ID and `running` status only. The pending-schedule tenant-scope slice now stores account and owner from separate trusted context. Keep the change local to finalization; claim and engine/cron remain unwired.

## In scope

- Validate separate trusted `{ userId, accountId }`, execution UUID, and terminal status before database work.
- Set transaction-local `request.jwt.claim.sub`; update by execution ID, trusted account, trusted owner, and current `running` status with parameterized SQL.
- Preserve `done`/`failed` transitions, safe errors, no-op behavior, and boolean result.
- Add focused tests and disposable Docker Desktop PostgreSQL 16 tenant proof for matching owner success, wrong-owner/account/viewer no-op or denial according to RLS contract, safe rollback, private-column preservation, and identity cleanup.
- Run focused Vitest, TypeScript, zero-warning targeted ESLint, targeted Prettier, PowerShell AST/fixture checks, `git diff --check`, and independent GPT-6 Luna read-only review until exact `APPROVE`, zero findings/caveats.

## Out of scope

Claim/list behavior; engine/cron or route/UI wiring; permanent schema/RLS/grant/role provisioning; runtime pool/role/credential, Auth/session, Supabase, real data/credentials, application traffic, production, branch/history changes, commit, push, or deploy. Use disposable PostgreSQL in Docker Desktop only. H-DATA-003/H-DB-003 remain unapproved overall.

## Validation

- `npx vitest run src/lib/repositories/automation-pending-finalize.test.ts --maxWorkers=1 --no-file-parallelism` — focused unit suite.
- `npx tsc --noEmit`; targeted ESLint with `--max-warnings=0`; targeted Prettier check.
- PowerShell AST/fixture checks, disposable Docker Desktop PostgreSQL 16 validator using generated credentials and synthetic rows, and `git diff --check`.
- Independent GPT-6 Luna read-only review; remediate and repeat until exact `APPROVE`, zero findings/caveats.

## Implementation and validation

- TDD RED failed 5/10 focused cases against the old ID/status-only signature. Record: `tdd-red-pending-finalize-tenant.log`.
- Finalization now requires trusted `{ userId, accountId }`, validates context/ID/status before database work, sets transaction-local `request.jwt.claim.sub`, and performs one parameterized update scoped by ID, account, owner, and `running` status. `done`/`failed`, no-op, safe error, and boolean result behavior remain.
- Focused Vitest passed 10/10; `npx tsc --noEmit`, targeted ESLint with `--max-warnings=0`, targeted Prettier check, PowerShell AST/fixture checks, and `git diff --check` passed. Logs are in this task folder. The first ESLint pass found one unused fixture variable; it was removed before final validation.
- Docker Desktop PostgreSQL 16 proof passed with synthetic tenants/rows, generated credentials, `--network none`, tmpfs database, read-only source mount, `NOBYPASSRLS`, forced RLS, minimum column grants, owner `done`/`failed` transitions, cross-account/other-owner/viewer denials, constraint rollback, private-column preservation, transaction-local identity cleanup, and no residual task resources. Final evidence: `validation-postgres-automation-pending-finalize-tenant-29df48d937.log`. The earlier `9a658afd5d` run predates removal of an unused variable and is superseded.
- No claim/engine/cron wiring, permanent schema/RLS/grant/role changes, pool/Auth/session changes, Supabase, real data/credentials, application traffic, production, or Git history/branch change. H-DATA-003/H-DB-003 remain unapproved overall; the fixture does not establish production policy/grant compatibility.

## Independent review

Independent GPT-6 Luna read-only review returned exact `APPROVE`, with zero actionable findings and zero caveats, limited to this pending-finalize tenant-scope slice. Record: `review-gpt6-luna-20261020.md`. This does not approve H-DATA-003/H-DB-003 overall or establish production policy/grant compatibility. Keep the HARNESS task `in_progress` pending owner-level review and later task decisions.

## Next action

Next narrow phase-03 slice: tenant-scope the pending-execution claim repository. Keep engine/cron unwired and all validation on disposable Docker PostgreSQL.
