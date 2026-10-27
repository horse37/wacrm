# Task — PostgreSQL automation pending terminal status

- id: `20261020-080513-a93e`
- type: `migration`
- slug: `postgres-automation-pending-finalize-persistence`
- status: `in_progress`

## Goal

Add an unwired PostgreSQL repository that transitions a claimed automation wait execution from `running` to `done` or `failed`.

## Context

The prior due-claim and pending-schedule repository slices have independent GPT-6 Luna `APPROVE` reviews, limited to their isolated implementations. Their HARNESS tasks remain `in_progress`; H-DATA-003/H-DB-003 and the migration overall remain unapproved. PostgreSQL proof must use disposable Docker Desktop only.

## In scope

- Validate the execution UUID and terminal status before opening a transaction.
- Perform a parameterized update guarded by `id` and current status `running`; report whether a row transitioned, with missing or non-running rows as no-op.
- Add unit tests and synthetic PostgreSQL 16 integration proof with forced RLS, `NOBYPASSRLS`, minimum test-only grants, and cleanup.
- Run focused Vitest, TypeScript, targeted zero-warning ESLint, Prettier, Docker Desktop PostgreSQL proof, `git diff --check`, and independent GPT-6 Luna read-only review until exact `APPROVE`, zero findings/caveats.

## Out of scope

Engine/cron wiring, claim or scheduling changes, schema/RLS/permanent grants, job-role or pool configuration, Auth, provider/message effects, Supabase persistence or validation, real data/credentials, application traffic, production, commit, push, deploy, reset, clean, rebase, or branch change. Preserve all local work. H-DATA-003/H-DB-003 remain unapproved overall.

## Validation

- `npx vitest run src/lib/repositories/automation-pending-finalize.test.ts --maxWorkers=1 --no-file-parallelism` — focused unit tests.
- `npx tsc --noEmit` and targeted `npx eslint ... --max-warnings=0` — type and lint checks.
- Targeted `npx prettier --check ...` and `git diff --check` — formatting and whitespace.
- `scripts/testing/validate-postgres-automation-pending-finalize.ps1` — isolated Docker Desktop PostgreSQL 16 forced-RLS proof and cleanup.
- Independent GPT-6 Luna read-only review; remediate and repeat until exact approval with zero findings and caveats.

## Next action

Implement and validate the isolated terminal-status repository; keep the engine/cron unwired.

## Implementation and validation

- Added `src/lib/repositories/automation-pending-finalize.ts`, an unwired server-only repository. It validates UUID and `done`/`failed` status before DB work, performs one parameterized transaction guarded by `id` and current status `running`, and returns whether one row transitioned. Invalid inputs fail before transaction; missing/non-running rows return `false`; unsafe row counts and DB failures map to safe errors.
- Added focused tests. TDD RED first failed because the repository module did not exist. Final Vitest passed 7/7; `npx tsc --noEmit`, targeted ESLint `--max-warnings=0`, targeted Prettier, PowerShell AST parse, and `git diff --check` passed.
- Disposable Docker Desktop PostgreSQL 16 integration passed using `--network none`, tmpfs, read-only repository mount, synthetic rows, forced RLS, `NOBYPASSRLS`, and only column-level SELECT(id,status) plus UPDATE(status). It verified successful `done`/`failed` transitions, no-op for pending/terminal/missing IDs, safe constraint failure with transaction rollback, unchanged private payload, and cleanup. Evidence: `validation-postgres-automation-pending-finalize-aefdfe9a4c.log`.
- The first PostgreSQL proof exposed an overly narrow SELECT policy in the synthetic fixture; it was corrected so the RLS fixture permits visibility of running and terminal queue states while the UPDATE policy still permits only running-to-terminal transitions. The corrected proof passed. No application SQL/schema/RLS/grant or runtime wiring was changed.

## Independent review

- Initial independent GPT-6 Luna review: `APPROVE`, zero findings, one caveat about reviewing an uncommitted working-tree diff. See `review-initial-20261020.md`.
- Follow-up independent GPT-6 Luna review of the disclosed frozen working-tree target: exact `APPROVE`, zero findings, zero caveats. See `review-post-implementation-20261020.md`.
- This approves only the isolated finalizer repository slice. Keep task `in_progress`; H-DATA-003/H-DB-003 remain unapproved overall.
