# Task — PostgreSQL automation pending-schedule tenant scope

- id: `20261020-120813-3e6f`
- type: `migration`
- slug: `postgres-automation-pending-schedule-tenant-scope`
- roadmap: H-DATA-003, phase 03
- status: `in_progress`

## Goal

Require trusted tenant/owner context for scheduling an automation wait execution and prove the insert under disposable PostgreSQL 16 tenant RLS.

## Context

The unwired pending-schedule repository currently accepts `accountId` and `userId` inside its execution payload and writes them directly. The automation-log create slice now separates trusted writer context from payload. Follow that narrow boundary here; do not wire the automation engine or cron.

## In scope

- Require separate trusted `{ userId, accountId }` writer context and queue execution input. Validate both before opening a transaction.
- Set transaction-local `request.jwt.claim.sub` before one parameterized INSERT. Source row account and owner only from trusted context; ignore payload identity fields.
- Preserve validated queue fields, optional context defaults, initial `pending` state, and generated UUID return behavior; map DB failures safely.
- Test validation/no transaction on invalid inputs, context-to-parameter mapping, GUC-before-INSERT ordering, forged payload identity, safe failures, and generated-ID validation.
- Add synthetic tenant fixture and Docker Desktop PostgreSQL 16 proof for owner insert, same-account other-owner denial, cross-account denial, viewer denial, stored-row audit, private-column preservation, transaction-local identity cleanup, and resource cleanup. Require forced RLS, `NOBYPASSRLS`, minimum column grants, `--network none`, tmpfs, read-only repository mounts, and generated credentials.
- Obtain independent GPT-6 Luna read-only review until exact `APPROVE`, zero findings, zero caveats; remediate and re-review as needed.

## Out of scope

Claim/finalization changes; engine/cron or route/UI wiring; permanent schema/RLS/grants/role provisioning; runtime pool/role/credential changes; Auth/session migration; Supabase, real data/credentials, application traffic, production; commit, push, deploy, reset, restore, clean, rebase, or branch change. The fixture is synthetic evidence only, not production policy approval. H-DATA-003/H-DB-003 remain unapproved overall.

## Validation

- `npx vitest run src/lib/repositories/automation-pending-schedule.test.ts --maxWorkers=1 --no-file-parallelism` — focused unit suite.
- `npx tsc --noEmit`, targeted ESLint with `--max-warnings=0`, and targeted Prettier check.
- PowerShell AST/fixture checks, `git diff --check`, and `scripts/testing/validate-postgres-automation-pending-schedule-tenant.ps1` using task-owned disposable Docker Desktop PostgreSQL 16 resources only.
- Independent GPT-6 Luna read-only review; remediate and repeat until exact approval with zero findings and caveats.

## Implementation and validation

- TDD RED run against the old signature failed 5/19 focused cases because callers passed writer context separately while the repository still treated it as execution payload. Record: `tdd-red-pending-schedule-tenant.log`.
- `automation-pending-schedule` now requires separate trusted writer context, validates it and the execution payload before starting a transaction, awaits transaction-local `request.jwt.claim.sub`, and sources `account_id`/`user_id` only from context. Payload identity fields do not override trusted values. Pending status, queue fields, optional context default, and generated UUID behavior remain.
- Final focused Vitest passed 19/19; TypeScript, targeted ESLint with `--max-warnings=0`, and targeted Prettier checks passed. Logs: `validation-vitest-final.log`, `validation-tsc-final.log`, `validation-eslint-final.log`, `validation-prettier-final.log`. The first TypeScript run found test mock-call tuple typing errors; they were fixed and typecheck rerun successfully. `validation-focused-current.log` and `validation-tsc.log` are earlier failed attempts, superseded by final logs.
- PowerShell AST, RLS fixture, role, and minimum-grant checks passed. Disposable Docker Desktop PostgreSQL 16 validation passed with generated credentials, synthetic rows, `--network none`, tmpfs database, read-only repository mounts, `NOBYPASSRLS`, forced RLS, minimum column grants, owner insert, same-account other-owner/cross-account/viewer denials, ignored forged payload identity, stored-row/private-column audit, safe constraint rollback, transaction-local identity cleanup, and no residual resources. Evidence: `validation-postgres-automation-pending-schedule-tenant-a9563730dd.log`.
- No claim/finalization changes, engine/cron wiring, permanent schema/RLS/grant/role provisioning, runtime pool/Auth/session changes, Supabase, real data/credentials, traffic, production, or Git history/branch change. H-DATA-003/H-DB-003 remain unapproved overall.

## Independent review

Independent GPT-6 Luna read-only review returned exact `APPROVE`, with zero actionable findings and zero caveats, limited to this pending-schedule tenant-scope slice. Record: `.harness/tasks/20261020-120813-3e6f/review-gpt6-luna-20261020.md`. This does not approve H-DATA-003/H-DB-003 overall or establish production policy/grant compatibility. Keep the HARNESS task `in_progress` pending owner-level review and later task decisions.
