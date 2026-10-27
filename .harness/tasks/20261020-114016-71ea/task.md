# Task — PostgreSQL automation-log creation tenant scoping

- id: `20261020-114016-71ea`
- type: `migration`
- slug: `postgres-automation-log-create-tenant-scope`
- roadmap: H-DATA-003, phase 03
- status: `in_progress`

## Goal

Require trusted tenant/owner context for automation-log creation and prove the insert under disposable PostgreSQL 16 tenant RLS before any engine wiring.

## Context

The existing creation repository was independently approved only for inserting an initial execution log with minimal grants; it currently accepts `accountId` and `userId` as part of its input and runs under a test-only permissive RLS policy. Automation-log append tenant scope and finalization tenant scope have separate slice-only approvals. This task closes the remaining create operation before considering engine/cron wiring.

## In scope

- Require a trusted `{ userId, accountId }` writer context sourced by trusted server code, never request input. Validate context and create payload before DB work.
- Set transaction-local `request.jwt.claim.sub` before one parameterized INSERT. Source row owner and tenant from the trusted context.
- Keep generated UUID return behavior and initial `success`/empty-steps semantics; map safe DB failures consistently.
- Unit-test validation, GUC-before-INSERT ordering, parameter mapping, safe failures, and the absence of a transaction on invalid input.
- Add a synthetic tenant fixture and Docker validator for PostgreSQL 16. Prove owner insert, same-account other-owner insert denial, cross-account denial, viewer denial, stored-row audit, private-column preservation, identity cleanup, and cleanup. Require test-only forced RLS, `NOBYPASSRLS`, minimum column grants, `--network none`, tmpfs, read-only mounts, and generated credentials.
- Obtain independent GPT-6 Luna read-only review until exact `APPROVE`, zero findings, zero caveats; remediate/re-review as needed.

## Out of scope

Append/finalization changes; engine/cron or route/UI wiring; permanent schema, RLS, grants, or role provisioning; runtime pool/role/credential changes; Auth/session migration; Supabase services, persistence, or validation; real data/credentials; application traffic; production; commit, push, deploy, reset, restore, clean, rebase, or branch change. The fixture policy is a test prototype, not proof of production policy compatibility. H-DATA-003/H-DB-003 remain unapproved overall.

## Validation

- Focused `npx vitest run src/lib/repositories/automation-log-create.test.ts --maxWorkers=1 --no-file-parallelism`.
- `npx tsc --noEmit`; targeted ESLint with `--max-warnings=0`; targeted Prettier check; `git diff --check`.
- PowerShell AST/fixture checks and `scripts/testing/validate-postgres-automation-log-create-tenant.ps1` using only task-owned disposable Docker Desktop PostgreSQL 16 resources.
- Independent GPT-6 Luna read-only review and remediation/re-review until exact approval with no findings or caveats.

## Implementation and validation

- TDD RED was recorded before production changes: six existing success/error paths failed because the repository still accepted tenant identity inside the execution payload (`tdd-red-automation-log-create-tenant.log`).
- Creation now takes trusted `{ userId, accountId }` context separately from execution input, validates both before opening a transaction, sets transaction-local `request.jwt.claim.sub`, and inserts tenant/owner from trusted context. Initial `success`, empty steps, and generated UUID behavior remain unchanged. Payload identity fields are ignored.
- Focused Vitest passed **14/14**; `npx tsc --noEmit`, targeted ESLint with `--max-warnings=0`, and targeted Prettier check passed. Command record: `validation-focused-final.log`.
- PowerShell AST, test-only PostgreSQL tenant fixture, forced RLS, `NOBYPASSRLS`, and minimum-column-grant checks passed. Disposable PostgreSQL 16 integration passed owner insert, same-account other-owner denial, cross-account denial, viewer denial, payload identity isolation, private-column protection, safe constraint failure, stored-row audit, transaction-local identity cleanup, and container cleanup. Final evidence: `validation-postgres-automation-log-create-tenant-4fd4c9837d.log`.
- The first integration run exposed a double-unwrapped result in the test harness; the harness was corrected and the full PostgreSQL validation then passed. Final audit wording was corrected to describe create-only assertions and PostgreSQL validation was repeated. No application bug was involved.
- Historical evidence is labeled by outcome: `validation-postgres-automation-log-create-tenant-9a354405a7.log` is the first harness failure (double unwrap, cleanup passed); `validation-postgres-automation-log-create-tenant-285cbddf65.log` passed the integration but has a stale inherited audit-summary sentence and is superseded. The authoritative final run is `validation-postgres-automation-log-create-tenant-4fd4c9837d.log`.
- No engine/cron wiring or permanent schema, RLS, grant, role, Auth, or session change. Supabase, real data/credentials, application traffic, and production were not used. H-DATA-003/H-DB-003 remain unapproved overall.

## Next action

Independent GPT-6 Luna read-only review returned `APPROVE`, zero findings/caveats, limited to this creation slice (`review-gpt6-luna-20261020.md`). Await the owner-run Opus 5.5 review before deciding on the next task; prompt is in `review-prompt-opus-5.5.md`.
