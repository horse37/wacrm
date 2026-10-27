# Task — PostgreSQL flow-header update persistence

- id: `20261020-050802-a6c1`
- type: `migration`
- slug: `postgres-flow-header-update-persistence`
- roadmap: H-DATA-003, phase 03
- status: `in_progress`

## Goal

Add an unwired PostgreSQL repository for partial updates to flow-editor header fields, scoped to an agent's verified account. Keep the route and graph replacement unchanged.

## Context

The existing `PUT /api/flows/[id]` updates flow header fields and optionally replaces nodes through Supabase. The preceding flow-delete repository slice received independent GPT-6 Luna `APPROVE`, limited to that slice. PostgreSQL in disposable Docker Desktop is the target; do not use Supabase.

## In scope

- Require a verified account session and `agent`-or-higher account role.
- Support only `name`, `description`, `trigger_type`, `trigger_config`, `entry_node_id`, and `fallback_policy`; update `updated_at` consistently.
- Use bound values and an explicit field allowlist; derive account/user identity from the verified PostgreSQL guard and set transaction-local RLS identity.
- Return safe `not_found` for missing or inaccessible rows.
- Prove forced RLS, `NOBYPASSRLS`, account/role isolation, exact column grants, allowlisted updates, identity cleanup, and database constraints using synthetic data in disposable Docker Desktop PostgreSQL 16.

## Out of scope

No route/UI wiring, Supabase/Auth/session migration, graph/node writes, status activation, provider calls, permanent schema/grant/RLS changes, real credentials/data, app traffic, production, commit, push, deploy, reset, clean, rebase, or branch change. Preserve every pre-existing local change. Keep this task `in_progress` and H-DATA-003/H-DB-003 unapproved overall.

## Validation

- Start with a failing focused Vitest, then run focused Vitest, TypeScript, zero-warning targeted ESLint, Prettier, PowerShell AST/fixture checks, and `git diff --check`.
- Run the task-owned PostgreSQL 16 integration in disposable Docker Desktop with forced RLS, runtime `NOBYPASSRLS`, minimum column grants, synthetic records/generated credentials, `--network none`, tmpfs, read-only mounts, and cleanup verification.
- Obtain independent GPT-6 Luna read-only review; remediate and repeat affected checks until exact `APPROVE`, zero findings, and zero caveats for this slice.

## Next action

The header-update repository slice received independent GPT-6 Luna read-only exact `APPROVE`, zero findings, and zero caveats. Continue with the next isolated flow persistence slice; keep routes unwired.

## Implementation and validation

- TDD RED confirmed `flow-header-update.ts` was absent. Focused Vitest passed 8/8; the combined flow-header, flow-delete, and flow-editor-load suites passed 27/27.
- Added an unwired server-only repository requiring an `agent`-or-higher verified account context. It accepts only six header fields, validates and normalizes values, parameterizes all data, scopes by flow/account with creator-profile consistency, sets transaction-local RLS identity, always updates `updated_at`, and returns safe not-found for inaccessible rows. Flow status and graph rows are not writable through this repository.
- TypeScript, targeted ESLint with `--max-warnings=0`, Prettier check, PowerShell AST parse, and `git diff --check` passed.
- Disposable Docker Desktop PostgreSQL 16 integration passed forced RLS on accounts/profiles/flows, `NOBYPASSRLS`, exact column grants, role and account isolation, allowlisted header persistence, database denial of status updates, and transaction identity cleanup. Synthetic-only records, generated credentials, `--network none`, tmpfs, read-only mounts, and no residual task resources. Evidence: `validation-postgres-flow-header-update-b089a62b10.log`.
- No route wiring, Supabase, Auth/session migration, graph writes, provider calls, real credentials/data, app traffic, production, commit, push, or deploy. Task remains `in_progress`; H-DATA-003/H-DB-003 remain unapproved overall.

## Independent read-only review

- Independent GPT-6 Luna reviewer returned exact `APPROVE`, zero findings, and zero caveats for this flow-header update persistence slice only.
- Review was read-only and limited to this repository, its tests, disposable PostgreSQL fixture/runner, and validation evidence. It does not approve route wiring, H-DATA-003/H-DB-003 overall, Auth/session migration, Supabase replacement, Storage, Realtime, application traffic, or production.
- Task remains `in_progress`; no commit, push, or deploy occurred.
