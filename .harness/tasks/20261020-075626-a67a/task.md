# Task — PostgreSQL automation wait scheduling

- id: `20261020-075626-a67a`
- type: `migration`
- slug: `postgres-automation-pending-schedule-persistence`
- status: `in_progress`

## Goal

Add an unwired PostgreSQL repository to persist automation wait executions.

## Context

The automation engine currently inserts wait rows through Supabase. The adjacent due-claim repository is independently approved for its isolated slice only: `.harness/tasks/20261020-074348-a853/review-post-remediation-20261020.md`. H-DATA-003/H-DB-003 remain unapproved overall.

## In scope

- Validate and insert one pending execution using the existing queue row shape, returning the generated UUID.
- Add unit and disposable PostgreSQL 16 integration coverage with synthetic data, forced RLS, `NOBYPASSRLS`, minimum test-only grants, transaction behavior, and cleanup.
- Run focused Vitest, TypeScript, targeted zero-warning ESLint, Prettier, Docker Desktop PostgreSQL proof, `git diff --check`, and independent GPT-6 Luna read-only review until exact `APPROVE`, zero findings/caveats.

## Out of scope

Engine/cron wiring, claim or terminal status updates, schema/RLS/permanent grant changes, job-role or pool configuration, Auth, provider/message effects, Supabase persistence or validation, real data/credentials, application traffic, production, commit, push, deploy, reset, clean, rebase, or branch change. Preserve all local work; H-DATA-003/H-DB-003 remain unapproved overall.

## Validation

- `npx vitest run src/lib/repositories/automation-pending-schedule.test.ts --maxWorkers=1 --no-file-parallelism` — focused unit tests.
- `npx tsc --noEmit` and targeted `npx eslint ... --max-warnings=0` — type and lint checks.
- Targeted `npx prettier --check ...` and `git diff --check` — formatting and whitespace.
- `scripts/testing/validate-postgres-automation-pending-schedule.ps1` — isolated Docker Desktop PostgreSQL 16 forced-RLS proof and cleanup.
- Independent GPT-6 Luna read-only review; remediate and repeat until exact approval with zero findings and caveats.

## Next action

Continue with a separate task for terminal status updates of claimed pending executions; keep the engine/cron unwired until the queue operations and role boundary are separately reviewed.

## Implementation and validation

Added `src/lib/repositories/automation-pending-schedule.ts`, an unwired server-only PostgreSQL repository for inserting a pending wait row. It validates UUIDs, nullable IDs, branch, non-negative position, optional `AutomationContext`, and `runAt` before opening a transaction; SQL values are parameterized and only the generated UUID is returned. Database errors are mapped safely. No engine/cron wiring, schema, RLS, grant, runtime-role, Auth, or provider changes.

TDD RED first failed because the repository module did not exist. Focused Vitest passed 17/17; `npx tsc --noEmit`, targeted ESLint `--max-warnings=0`, targeted Prettier check, and `git diff --check` passed. Docker Desktop PostgreSQL 16 integration passed with a `--network none` database container, tmpfs database, read-only repository mount, synthetic rows, generated credentials, forced RLS, `NOBYPASSRLS`, column-only INSERT plus SELECT(id), no table-level privileges, and verified cleanup. It checked generated IDs, stored queue fields/defaults, pending status, and safe handling of a database constraint failure with no rejected row persisted. Evidence: `validation-postgres-automation-pending-schedule-a3efe7d6ba.log`.

Independent GPT-6 Luna rereview returned exact `APPROVE`, zero findings, zero caveats, limited to this isolated repository. Keep this task `in_progress`; H-DATA-003/H-DB-003 remain unapproved overall. Engine/cron integration, claim/final status updates, actual role grants/policies, Supabase replacement outside this isolated repository, real data, traffic, and production remain outside this slice.
