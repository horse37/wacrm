# Task — PostgreSQL automation pending-claim tenant scope

- id: `20261020-123450-7a32`
- type: `migration`
- slug: `postgres-automation-pending-claim-tenant-scope`
- roadmap: H-DATA-003, phase 03
- status: `in_progress`

## Goal

Restrict pending automation wait claims to one trusted account and prove isolation, ordering, atomic claiming, and least-privilege RLS in disposable PostgreSQL 16.

## Context

The existing unwired claim repository selects due rows across every account. Scheduling and finalization now require separate trusted `{ userId, accountId }` context. A claim is account-scoped because a tenant worker must resume waits owned by multiple members; it must preserve each row's `user_id` in the projected execution. This does not define or wire a production worker role.

## In scope

- Require and validate trusted actor/account context, `asOf`, and batch limit before database work; set transaction-local `request.jwt.claim.sub`.
- Filter due selection and update by trusted account ID, retain `pending`/due eligibility, deterministic order, limit, atomic transition to `running`, `FOR UPDATE SKIP LOCKED`, projection and safe row validation.
- Keep owner `user_id` from stored row in results; do not use payload identity or actor as row owner.
- Update unit and existing disposable integration callers for the new context contract; add a task-owned Docker PostgreSQL 16 forced-RLS/minimum-grant proof for two accounts, multiple owners in one account, viewer/nonmember denial, concurrency, cleanup, and private-column protection.
- Run focused Vitest, TypeScript, zero-warning targeted ESLint, Prettier, PowerShell AST/fixture checks, existing and tenant-scoped Docker integrations, `git diff --check`, then independent GPT-6 Luna read-only review until exact `APPROVE`, zero findings/caveats.

## Out of scope

Engine/cron or route/UI wiring; claim orchestration across all tenants; permanent schema/RLS/grant/role provisioning; runtime pool/role/credentials, Auth/session, Supabase, real data, application traffic, production, branch/history changes, commit, push, or deploy. Use disposable PostgreSQL in Docker Desktop only. H-DATA-003/H-DB-003 remain unapproved overall.

## Validation

- `npx vitest run src/lib/repositories/automation-pending-claim.test.ts --maxWorkers=1 --no-file-parallelism` — focused unit suite.
- `npx tsc --noEmit`; targeted ESLint `--max-warnings=0`; targeted Prettier check.
- Run existing `scripts/testing/validate-postgres-automation-pending-claim.ps1` and new tenant-scoped validator against generated credentials and synthetic Docker PostgreSQL 16 only. Include PowerShell AST/fixture and `git diff --check`.
- Independent GPT-6 Luna read-only review; remediate/re-review until exact `APPROVE`, zero findings/caveats.

## Validation results — 2026-10-20

- TDD RED: 9/17 failed before implementation in `tdd-red-claim-tenant.log`.
- Focused Vitest: 17/17 passed. TypeScript passed. Targeted ESLint passed with `--max-warnings=0`; Prettier check passed.
- Existing PostgreSQL 16 claim proof passed: `.harness/tasks/20261020-074348-a853/validation-postgres-automation-pending-claim-3537349ee6.log`.
- Tenant-scoped Docker Desktop PostgreSQL 16 proof passed: `.harness/tasks/20261020-123450-7a32/validation-postgres-automation-pending-claim-tenant-82ade65185.log`. Forced RLS, minimum column grants, account isolation, viewer/nonmember denial, multiple row owners, transaction-local identity cleanup, private-column denial, `SKIP LOCKED`, and disjoint concurrent batches passed. Container cleanup found no residual task resources.
- PowerShell AST and fixture checks passed. `git diff --check` and task-source whitespace/final-newline checks passed.
- Independent read-only GPT-6 Luna review: **APPROVE**, zero findings, zero caveats. Record: `review-gpt6-luna-20261020.md`. Approval covers this task diff only; H-DATA-003/H-DB-003 remain unapproved overall.

## Next action

Inspect remaining H-DATA-003 work and define the next narrow HARNESS task; do not infer global approval from this task review.
