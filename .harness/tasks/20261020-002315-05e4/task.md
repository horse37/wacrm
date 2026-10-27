# Task — PostgreSQL pipeline-list read repository

- id: `20261020-002315-05e4`
- type: `migration`
- slug: `postgres-pipeline-list-read`

## Goal

Add a server-only PostgreSQL repository to list pipelines in the verified account.

## Context

H-DATA-003 phase 03. Use task-owned disposable PostgreSQL in Docker Desktop; do not use Supabase. Consumer wiring stays pending H-SELF-002 and H-DB-003. Existing pipeline board orders pipelines by `created_at` ascending.

## In scope

- Require verified account membership for any account role and set transaction-local RLS identity.
- Query pipelines with explicit guard-derived `account_id` scope and same-account creator profile.
- Map existing `Pipeline` projection, preserve nullable legacy `created_at`, and preserve ascending creation order with stable ID tie-break.
- Focused tests and synthetic forced-RLS PostgreSQL proof for projection, account and creator isolation, nullable timestamp handling, order, empty result, no-session rejection, fail-closed RLS, and pooled identity cleanup.

## Out of scope

No UI/route wiring, Supabase/Auth replacement, pipeline writes, stage/deal/contact hydration, schema/grant/RLS changes, other repositories, Realtime, real data/credentials, existing Docker resources, traffic, production, commit, push, deploy, reset, clean, rebase, or branch changes.

## Validation

- Focused Vitest, TypeScript, targeted zero-warning ESLint, Prettier, PowerShell fixture/script checks, and `git diff --check`.
- Disposable PostgreSQL 16 with synthetic forced-RLS fixtures, runtime `NOBYPASSRLS`, `--network none`, tmpfs, read-only mounts, no ports/named volumes, and cleanup assertion.

## Next action

Continue with a separate pipeline-stage read slice; keep this task `in_progress` and consumers unwired.

## Results

- TDD RED confirmed the repository was absent. Added `src/lib/repositories/pipeline-list.ts` with verified-account guard, transaction-local RLS identity, explicit account scope, same-account creator-profile join, existing `Pipeline` projection, and stable `created_at ASC NULLS LAST, id ASC` order.
- Focused repository/account-guard Vitest passed 13/13; TypeScript, targeted ESLint (`--max-warnings=0`), Prettier, PowerShell AST/fixture whitespace, and `git diff --check` passed.
- Disposable PostgreSQL 16 Docker forced-RLS integration passed with synthetic data, runtime `NOBYPASSRLS`, `--network none`, tmpfs, readonly mounts, no ports/named volumes, and no residual resources. Projection, account/creator isolation, tie ordering, viewer, empty account, no-session, fail-closed RLS, and pooled identity cleanup passed. Evidence: `.harness/tasks/20261020-002315-05e4/validation-postgres-pipeline-list-3b1b7935df.log`.
- No Supabase, consumer wiring, Auth/session changes, pipeline writes, schema/grants/RLS changes, real data, traffic, or production were touched.
- Independent Luna review found two P2 gaps: nullable `pipelines.created_at` was rejected by mapping, and the forced-RLS fixture lacked a cross-account creator. Remediation preserves SQL `NULL` in the `Pipeline` contract and tests it; the fixture now enforces a creator-profile FK and includes a pipeline whose creator belongs to another account. Revalidation and fresh independent review are pending.
- Remediation validation passed: focused Vitest 14/14, `npx tsc --noEmit`, targeted ESLint with `--max-warnings=0`, Prettier, PowerShell AST/whitespace, and `git diff --check`. Docker Desktop disposable PostgreSQL 16 forced-RLS integration passed with null timestamp and cross-account creator cases; evidence: `.harness/tasks/20261020-002315-05e4/validation-postgres-pipeline-list-816774a762.log`.
- Fresh independent same-model GPT-6 Luna read-only review returned `APPROVE`, zero findings and zero caveats, limited to the pipeline-list slice. Task remains `in_progress`; H-DATA-003 overall and consumer wiring remain unapproved.
