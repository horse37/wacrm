# Task — PostgreSQL automation creation persistence

- id: `20261020-062203-ae91`
- type: `migration`
- slug: `postgres-automation-create-persistence`
- roadmap: H-DATA-003, phase 03
- status: `in_progress`

## Goal

Add an unwired PostgreSQL repository that atomically creates an automation and its optional steps for the verified account, preserving draft and validated activation behavior.

## Context

`POST /api/automations` currently resolves optional static templates, validates an active automation, inserts its row, then inserts steps separately through Supabase admin. Automation list, editor, delete, and duplicate persistence are separate slice-limited repositories. Use Docker Desktop PostgreSQL with synthetic data only; never use Supabase.

## In scope

- Require verified `agent` membership and use only guard-derived user/account IDs.
- Accept effective automation fields from a future caller; static template selection/resolution stays outside this persistence slice.
- Preserve tree-shaped builder steps and legacy flat template seeds (`parent_index`/`branch`); validate object shapes, condition parents, branch values, and input bounds before writes; generate database step UUIDs and positions.
- Preserve draft creation with incomplete/empty steps; when `is_active` is true, use existing trigger/step activation validators and reject invalid configurations before writes.
- Insert the automation and all steps atomically in one transaction; return safe created metadata; roll back the parent on any child failure.
- Prove forced RLS, `NOBYPASSRLS`, exact minimum grants, user/account isolation, tree and flat seed mapping, draft/active validation behavior, rollback, transaction identity cleanup, and Docker resource cleanup on disposable PostgreSQL 16.

## Out of scope

No route/UI wiring, template catalog/database migration, Supabase/Auth/session migration, automation PATCH/delete/duplicate semantics, engine/cron work, permanent schema/grant/RLS changes, real credentials/data, app traffic, production, commit, push, deploy, reset, clean, rebase, or branch change. Preserve all pre-existing local changes. Keep this task `in_progress` and H-DATA-003/H-DB-003 unapproved overall.

## Validation

- Start with a failing focused Vitest; then run repository/account-guard Vitest, TypeScript, targeted zero-warning ESLint, Prettier, PowerShell AST/fixture checks, and `git diff --check`.
- Run task-owned Docker Desktop PostgreSQL 16 with synthetic rows/generated credentials, forced RLS, runtime `NOBYPASSRLS`, exact minimum grants, `--network none`, tmpfs, read-only mount, no ports/named volumes, transactional and isolation probes, and cleanup verification.
- Obtain independent GPT-6 Luna read-only review; remediate and repeat affected checks until exact `APPROVE`, zero findings, and zero caveats for this slice.

## Next action

Independent GPT-6 Luna read-only review returned exact `APPROVE`, zero findings, and zero caveats for this repository slice only; record: `.harness/tasks/20261020-062203-ae91/review-post-implementation-20261020.md`. Continue with a separate automation-update persistence task; keep this task `in_progress`, route/UI unwired, and H-DATA-003/H-DB-003 unapproved overall.

## Implementation and validation

TDD RED confirmed the repository module was absent. Added an unwired server-only repository that requires verified `agent` membership, derives user/account IDs only from the guard, preserves static template resolution outside persistence, parses the builder's nested tree and legacy flat `parent_index`/`branch` seeds, generates UUIDs, assigns per-scope positions, and writes the parent plus steps in one transaction. Incomplete drafts remain allowed; active creations reuse the existing activation validators and fail before writes if trigger or steps are invalid. Malformed/mixed/cyclic/disconnected input, excess step count/depth, invalid parent/branch, and duplicate generated IDs fail closed. Step insert failure rolls back the automation row.

Focused repository/account-guard Vitest passed 20/20; `npx tsc --noEmit`, targeted ESLint with zero warnings, Prettier check, PowerShell AST/fixture checks, and `git diff --check` passed. Final disposable Docker Desktop PostgreSQL 16 evidence: `.harness/tasks/20261020-062203-ae91/validation-postgres-automation-create-916bbb7dbb.log`. Forced RLS, `NOBYPASSRLS`, exact minimum grants, nested and flat steps, activation validation, account-derived identity, draft defaults, synthetic rollback, and RLS isolation passed. A separate pool-one integration proved the same backend PID and cleared transaction-local `auth.uid()` after commit. Docker used synthetic rows/generated credentials, `--network none`, tmpfs, read-only mounts, no ports/named volumes, and confirmed no residual resources.

No route/UI or Supabase wiring, real data/credentials, app traffic, production, commit, push, or deploy. Independent review is pending; this slice approval will not approve H-DATA-003 or H-DB-003.
