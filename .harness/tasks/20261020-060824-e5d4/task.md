# Task — PostgreSQL automation duplicate persistence

- id: `20261020-060824-e5d4`
- type: `migration`
- slug: `postgres-automation-duplicate-persistence`
- roadmap: H-DATA-003, phase 03
- status: `in_progress`

## Goal

Add an unwired PostgreSQL repository that duplicates only the verified user's automation in the verified account, including a new copy of its steps with remapped parent IDs.

## Context

`POST /api/automations/[id]/duplicate` currently reads an automation and its steps and inserts the copy through the Supabase admin client in separate operations. The automation list, log, editor-load, and delete persistence slices have limited independent approvals. Use synthetic PostgreSQL in disposable Docker Desktop only; do not use Supabase.

## In scope

- Require the existing verified-session account guard and minimum `agent` role; validate the source UUID before mutation.
- Read only a source automation matching its ID, verified user/account, and consistent creator profile in a `REPEATABLE READ` transaction; return safe `not_found` for missing, non-owned, cross-account, or inconsistent rows. Do not require `UPDATE` privileges just to lock a read-only source.
- In one transaction, insert a copy with name suffix ` (Copy)`, copied description/trigger fields, `is_active = false`, reset execution metadata, and guard-derived user/account identity.
- Copy steps with fresh UUIDs, preserve type/config/branch/position, remap parent IDs, and fail closed/rollback if a parent does not belong to the source graph.
- Prove forced RLS, runtime `NOBYPASSRLS`, exact minimum grants, creator/account isolation, step-ID remapping, rollback, and identity/resource cleanup using synthetic rows in Docker Desktop PostgreSQL 16.

## Out of scope

No route/UI wiring, Supabase/Auth/session migration, automation creation or PATCH semantics, activation validation, engine/cron work, permanent schema/grant/RLS changes, real credentials/data, app traffic, production, commit, push, deploy, reset, clean, rebase, or branch change. Preserve all pre-existing local changes. Keep this task `in_progress` and H-DATA-003/H-DB-003 unapproved overall.

## Validation

- Start with failing focused Vitest; then run focused repository/guard tests, TypeScript, targeted zero-warning ESLint, Prettier, PowerShell AST/fixture checks, and `git diff --check`.
- Run task-owned Docker Desktop PostgreSQL 16 with forced RLS, `NOBYPASSRLS`, exact minimum privileges, synthetic records/generated credentials, `--network none`, tmpfs, read-only mounts, isolation/remapping/rollback probes, and cleanup verification.
- Obtain independent GPT-6 Luna read-only review; remediate and repeat affected checks until exact `APPROVE`, zero findings, and zero caveats for this slice.

## Next action

Independent GPT-6 Luna read-only review returned exact `APPROVE`, zero findings, and zero caveats for this repository slice only; record: `.harness/tasks/20261020-060824-e5d4/review-post-implementation-20261020.md`. Continue with a separate automation-creation persistence task; keep this task `in_progress`, route unwired, and H-DATA-003/H-DB-003 unapproved overall.

## Implementation and validation

Added the unwired server-only PostgreSQL repository with verified `agent` guard, source ID/user/account/creator scoping, a transaction-local RLS identity, and a `REPEATABLE READ` snapshot so automation metadata and steps come from one consistent view without granting `UPDATE` for a source lock. The repository inserts an inactive copy with reset execution metadata and clones the full step graph with generated IDs and remapped parents in the same transaction; malformed or disconnected graphs fail closed, and child-insert errors roll back the parent.

The first Docker run exposed that `SELECT ... FOR UPDATE` exceeded the runtime's read/insert-only grants; this was replaced with the repeatable-read snapshot and the exact minimum grants were retained. A TypeScript narrowing issue in parsing `branch` was also corrected. Final focused repository/guard Vitest passed 17/17; `npx tsc --noEmit`, targeted ESLint with zero warnings, Prettier check, and `git diff --check` passed. Final Docker Desktop PostgreSQL 16 evidence: `.harness/tasks/20261020-060824-e5d4/validation-postgres-automation-duplicate-c9d4c366de.log`. The runner passed forced RLS, `NOBYPASSRLS`, exact column grants, creator/account isolation, invalid-tree rejection, atomic rollback, inactive metadata, graph remapping, empty automation, and pool-one identity cleanup on the same backend. It used synthetic rows/generated credentials, `--network none`, tmpfs, a read-only repository mount, no published ports or named volumes, and verified no residual task resources. The earlier failed log `.harness/tasks/20261020-060824-e5d4/validation-postgres-automation-duplicate-c9780d4a5a.log` is retained.

No route/UI or Supabase wiring, real data/credentials, app traffic, production, commit, push, or deploy. Independent review is pending; this slice approval will not approve H-DATA-003 or H-DB-003.
