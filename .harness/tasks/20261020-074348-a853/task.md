# Task — PostgreSQL automation due-execution claim

- id: `20261020-074348-a853`
- type: `migration`
- slug: `postgres-automation-due-claim-persistence`
- status: `in_progress`

## Goal

Add an unwired PostgreSQL repository that atomically claims due automation wait executions for a future cron integration.

## Context

Automation CRUD, editor, logs, and list slices now use PostgreSQL repositories/routes and have limited independent approvals. The cron route and execution engine still use Supabase data calls; this task handles only the queue claim persistence primitive, not route/engine wiring. H-DB-003 records no permanent data grants until a concrete consumer operation is defined. PostgreSQL evidence must use disposable Docker Desktop only.

## In scope

- List and atomically claim at most 50 rows with `status='pending'` and `run_at <= asOf`; return only fields needed by `resumePendingExecution`.
- Use one PostgreSQL transaction with row locks / `SKIP LOCKED` so concurrent claimers cannot receive the same execution; order deterministically by due time and ID.
- Validate `asOf` and limit before querying. Add focused tests for eligibility, field projection, order, concurrent distinct claims, and invalid inputs.
- Run focused Vitest, TypeScript, targeted zero-warning ESLint, Prettier, disposable Docker Desktop PostgreSQL 16 proof with forced RLS and minimum synthetic grants, and `git diff --check`. Obtain independent GPT-6 Luna review until exact `APPROVE`, zero findings/caveats.

## Out of scope

Cron route/engine wiring, provider/message execution, runtime/job pool/config or grants, migration/schema/RLS changes, Auth/session changes, Supabase persistence or validation calls, real data/credentials, traffic, production, commit, push, deploy, reset, clean, rebase, or branch change. Preserve all local work and keep H-DATA-003/H-DB-003 unapproved overall.

## Next action

Continue with a separate task for the next automation pending-execution write operation; keep the cron/engine unwired until the persistence slices and role boundary are separately reviewed.

## Implementation and validation

Added `src/lib/repositories/automation-pending-claim.ts`, an unwired server-only repository. It validates the timestamp and a 1–50 limit before opening a transaction, selects due `pending` rows in `(run_at, id)` order using `FOR UPDATE SKIP LOCKED`, changes their status to `running` atomically, and returns only the ten fields consumed by `resumePendingExecution`. Malformed database rows fail as a safe `db_error`; malformed output causes the enclosing transaction to roll back. Context validation checks the known optional string fields and requires `vars` to be a plain object. No cron/engine wiring, schema, RLS, grants, Auth, or provider behavior changed.

TDD RED first failed because the repository module did not exist. The initial independent review found one P2 for nested context types; remediation and review trail: `review-initial-20261020.md`, `review-remediation-20261020.md`, and `review-post-remediation-20261020.md`. Final read-only GPT-6 Luna result: exact `APPROVE`, zero findings, zero caveats, limited to this slice. Post-remediation focused Vitest passed 14/14; `npx tsc --noEmit`, targeted ESLint `--max-warnings=0`, targeted Prettier check, and `git diff --check` passed. Docker Desktop PostgreSQL 16 integration passed using a `--network none` database container, tmpfs database, read-only repository mount, synthetic fixture, `NOBYPASSRLS`, forced RLS, SELECT plus column-only UPDATE(status), generated credentials, and verified cleanup. It proved the inclusive due-time boundary, stable order, eligibility, projection, `SKIP LOCKED`, releasing and reclaiming a locked row, and two concurrent disjoint batches (8/8 unique rows). Final evidence: `validation-postgres-automation-pending-claim-2d823a0f3a.log`; earlier fixture-order experiments are recorded in adjacent failed logs and were corrected before the final pass.

Independent review is still pending. Keep the task `in_progress`; H-DATA-003/H-DB-003 remain unapproved overall. PostgreSQL runtime wiring, cron/engine integration, actual role grants/policy, Supabase removal outside this repository slice, real data, traffic, and production remain outside this task.
