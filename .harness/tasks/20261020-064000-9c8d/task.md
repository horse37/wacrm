# Task — PostgreSQL automation update persistence

- id: `20261020-064000-9c8d`
- type: `migration`
- slug: `postgres-automation-update-persistence`
- roadmap: H-DATA-003, phase 03
- status: `in_progress`

## Goal

Add an unwired PostgreSQL repository for atomic automation header and step-tree updates, preserving existing ownership, activation validation, and step replacement behavior.

## Context

`PATCH /api/automations/[id]` currently filters a header allowlist, validates the effective active configuration, updates the automation, and optionally replaces steps using separate Supabase calls. The create, delete, duplicate, and editor persistence slices are independent. Use disposable Docker Desktop PostgreSQL with synthetic data only; never Supabase.

## In scope

- Require verified `agent` membership; derive user/account identity only from the account guard and scope the automation query to both IDs.
- Accept only the current PATCH allowlist (`name`, `description`, `trigger_type`, `trigger_config`, `is_active`) and optional builder tree `steps`; preserve omitted fields.
- Lock and load the automation in a transaction; validate the merged effective trigger and steps whenever the resulting automation remains active.
- Atomically update the parent and replace the optional nested step tree, with rollback on any error; generate fresh step IDs and preserve branch/position mapping, matching the builder's current payload.
- Prove forced RLS, `NOBYPASSRLS`, minimum column grants, ownership/account isolation, active/draft behavior, steps-only and header-only patches, rollback, same-backend identity cleanup, and Docker resource cleanup on disposable PostgreSQL 16.

## Out of scope

No route/UI wiring, Supabase/Auth/session migration, engine/cron work, permanent schema/grant/RLS changes, unrelated automation operations, real credentials/data, app traffic, production, commit, push, deploy, reset, clean, rebase, or branch change. Preserve all existing local changes. Keep this task `in_progress` and H-DATA-003/H-DB-003 unapproved overall.

## Validation

- Start with failing focused Vitest; run repository/account-guard Vitest, TypeScript, targeted zero-warning ESLint, Prettier, PowerShell AST/fixture checks, and `git diff --check`.
- Run task-owned Docker Desktop PostgreSQL 16 with synthetic rows/generated credentials, forced RLS, runtime `NOBYPASSRLS`, exact minimum grants, `--network none`, tmpfs, read-only mount, no ports/named volumes, transactional/isolation probes, and cleanup verification.
- Obtain independent GPT-6 Luna read-only review; remediate and repeat affected checks until exact `APPROVE`, zero findings, and zero caveats for this slice.

## Implementation and validation

TDD RED confirmed the update repository was absent. Added an unwired repository requiring verified `agent` membership and scoping by guard-derived user/account IDs. It locks the selected automation, applies only the existing header allowlist, validates the resulting active trigger and step tree, rejects corrupt stored graphs including repeated nodes and disconnected cycles, and atomically updates fields plus optional nested/legacy-flat step replacement. Step rows use fresh IDs unless the current supported payload supplies valid IDs; child failure rolls back header, steps, and pending-execution FK changes.

Focused repository/account-guard Vitest passed 18/18, including self and two-step stored cycles; TypeScript, zero-warning ESLint, Prettier, PowerShell AST/fixture checks, and `git diff --check` passed. Final disposable Docker Desktop PostgreSQL 16 evidence: `.harness/tasks/20261020-064000-9c8d/validation-postgres-automation-update-2791468aed.log`. Forced RLS, `NOBYPASSRLS`, exact minimum column/table grants, owner/account isolation, header/steps-only changes, active/draft validation, nested replacement, rollback of pending FK behavior, pool-one identity cleanup, and resource cleanup passed using synthetic data and generated credentials with `--network none`, tmpfs, read-only mount, and no ports/named volumes.

No route/UI or Supabase wiring, real data/credentials, app traffic, or production. Initial independent read-only review found one medium item: stored-step graph traversal now has explicit visited-node cycle detection and unit tests for self-reference and two-step cycles. The focused checks and Docker PostgreSQL validation were rerun, then independent GPT-6 Luna read-only rereview returned exact `APPROVE`, zero findings, and zero caveats for this slice. Records: `.harness/tasks/20261020-064000-9c8d/review-initial-20261020.md` and `.harness/tasks/20261020-064000-9c8d/review-post-remediation-20261020.md`. Keep this HARNESS task `in_progress`; H-DATA-003/H-DB-003 remain unapproved overall.
