# Task — PostgreSQL automation-log append tenant scoping

- id: `20261020-083929-c2a6`
- type: `migration`
- slug: `postgres-automation-log-append-tenant-scope`
- status: `in_progress`

## Goal

Require explicit trusted automation-owner/account context for PostgreSQL log append, scope the UPDATE by both tenant and owner, and prove the append path against account-membership RLS in disposable PostgreSQL.

## Context

The approved append repository is currently unwired and updates by log ID only. Migration 006's legacy policy is replaced in migration 017 by `automation_logs_select`; the source migration contains no UPDATE policy. Existing append integration uses permissive `USING (true)` test policy and does not prove tenant isolation. Current server-side account guard derives identity from a verified session, then transaction-local `request.jwt.claim.sub`; the PostgreSQL login is shared, so the claim is trusted only inside server code. It is not an immutable database identity and does not defend against arbitrary SQL under the runtime credential.

## In scope

- Add an explicit `{ userId, accountId }` writer context to the unwired append repository; validate both UUIDs before DB work.
- Set the verified/automation-owner user ID transaction-locally before the append statement. Require `logId`, `account_id`, and `user_id` to match in the parameterized UPDATE.
- Unit-test missing/invalid context, required predicate and GUC order, tenant mismatch no-op, append semantics, and safe failures.
- Keep the earlier append Docker runner/fixture compatible with the new context signature; retain its prior validation log as historical evidence.
- Add a Docker-only PostgreSQL 16 integration fixture with synthetic account/profile membership, an `is_account_member`-style SECURITY DEFINER helper, `FORCE ROW LEVEL SECURITY`, `NOBYPASSRLS`, exact minimum grants, same-account owner success, same-account different-owner denial, cross-account denial, membership denial, transaction-local identity cleanup, audit, and cleanup.
- Obtain independent GPT-6 Luna read-only review until exact `APPROVE`, zero findings/caveats, limited to this slice.

## Out of scope

Engine/cron wiring; finalization/create repositories; permanent SQL migrations, RLS policies, grants, or role provisioning; DATABASE_URL/job-pool changes; Auth or external identity; Supabase service/network/persistence; arbitrary SQL or compromised-server threat protection; real data/credentials; app traffic; production; commit, push, deploy, reset, clean, rebase, or branch change. The Docker policy is a prototype, not proof that production roles/policies are installed. H-DATA-003/H-DB-003 remain unapproved.

## Validation

- Focused Vitest for `automation-log-append.test.ts`.
- `npx tsc --noEmit`, targeted ESLint with `--max-warnings=0`, targeted Prettier check.
- PowerShell AST parse, `git diff --check`.
- Disposable Docker Desktop PostgreSQL 16 tenant/RLS integration with generated credentials, `--network none`, tmpfs, read-only repository mounts, no published ports/volumes, and cleanup proof.
- Independent GPT-6 Luna read-only review; remediate and repeat until exact approval with zero findings/caveats.

## Next action

Independent GPT-6 Luna round 1 returned `REMEDIATION_REQUIRED` for missing same-account/different-owner coverage. Added another agent and log in account A, a false append assertion, and stored-row unchanged checks. Focused validation passed. Round 2 returned `APPROVE`, zero findings/caveats (`review-remediation-20261020.md`). Keep engine wiring disabled.

## Implementation and validation

- TDD RED first showed six existing success/error-path cases rejecting the new writer-context signature; implemented explicit owner/account UUID validation, transaction-local actor setup, and parameterized `id + account_id + user_id` predicates. Focused Vitest passed 18/18.
- Updated the previous append Docker runner/fixture to pass explicit synthetic context and grant the two read-only scope columns; prior validation evidence remains unchanged.
- Re-ran the compatible prior append PostgreSQL 16 integration successfully after replacing PowerShell-sensitive embedded JSON audit literals with `jsonb_build_object`: `.harness/tasks/20261020-082011-cb3a/validation-postgres-automation-log-append-764daadf1c.log`.
- Docker-only fixture models three synthetic tenant accounts, two agents and a viewer in account A, membership-based SELECT/UPDATE policies, `FORCE RLS`, `NOBYPASSRLS`, and minimum column grants. Same-account owner append passed; same-account different-owner append returned false and left the row unchanged; cross-account, viewer, and unrelated-member UPDATE attempts changed zero rows. Concurrent append, safe rollback, preserved private payload, and post-commit GUC cleanup passed.
- Before review, tenant proof passed without the same-account/different-owner case (`validation-postgres-automation-log-append-tenant-f37daff718.log`); it is superseded for that gap. After remediation, focused Vitest passed 18/18, TypeScript passed, targeted ESLint passed with zero warnings, targeted Prettier passed, and Docker PostgreSQL 16 plus PowerShell AST/fixture checks passed: `validation-postgres-automation-log-append-tenant-bf73e7e8ec.log`; cleanup reported no residual resources.
- Two earlier Docker attempts failed in fixture/bootstrap and PowerShell audit quoting; failures are preserved in `validation-postgres-automation-log-append-tenant-41ae5b040e.log` and `validation-postgres-automation-log-append-tenant-f34c4a3992.log`. Both reported cleanup success. No application engine/cron, permanent policy/grant, or runtime role was changed.
- Independent review round 1 returned `REMEDIATION_REQUIRED`, one P2: fixture lacked same-account different-owner coverage. Round 2 returned `APPROVE`, zero findings and zero caveats; see `review-remediation-20261020.md`. Approval covers this slice only.
