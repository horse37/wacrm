# Task — PostgreSQL template edit persistence

- id: `20261020-042158-7c91`
- type: migration
- slug: `postgres-template-edit-persistence`
- roadmap: H-DATA-003, phase 03
- status: `in_progress`

## Goal

Add an unwired server-only PostgreSQL repository for persisting one template lifecycle edit outcome.

## Context

The current `[id]` PATCH route edits an already submitted template. After provider failure it stores only `submission_error` and `last_submitted_at`; after success it updates template components/category, sets `PENDING`, clears stale error/rejection, and stores the submit timestamp. It leaves name, language, and `meta_template_id` intact. Migration 017 restricts writes to account admins. Use only disposable PostgreSQL in Docker Desktop; never Supabase.

## In scope

- Require verified admin membership and transaction-local RLS identity.
- Accept discriminated provider-failure and provider-success outcomes; validate UUID, timestamp, nonempty failure, shared template payload rules, and reject Authentication templates as the route does.
- Find the target by ID/account with creator profile/account consistency; require a submitted template in an editable status; fail closed on malformed/duplicate rows.
- Serialize writes per template ID.
- Failure updates only provider error and last-submitted time. Success persists category/components, sets `PENDING`, clears stale submission/rejection errors, and updates last-submitted time. Preserve name, language, provider ID, account/user, and trigger-managed `updated_at`.
- Return only validated UUID and `updated` action.
- Prove forced RLS, runtime `NOBYPASSRLS`, minimum column grants, success/failure outcomes, authorization/state rejection, timestamp trigger, same-row concurrency, and cleanup in disposable Docker Desktop PostgreSQL 16.

## Out of scope

No route/UI wiring, provider calls, external network, Auth/session replacement, schema/grant/RLS edits, Supabase, real credentials/data, app traffic, production, commit, push, deploy, reset, clean, rebase, or branch change. Writes only to task-owned synthetic Docker data. Keep this task `in_progress`; H-DATA-003/H-DB-003 remain unapproved overall.

## Validation

Start with failing focused Vitest. Run focused Vitest, TypeScript, targeted zero-warning ESLint, Prettier, PowerShell AST/fixture checks, `git diff --check`, and disposable Docker Desktop PostgreSQL 16 integration with `--network none`, tmpfs, read-only mounts, generated credentials, exact minimum privileges, forced RLS, concurrency, and cleanup verification. Obtain fresh independent GPT-6 Luna read-only review; remediate and repeat until exact `APPROVE`, zero findings, and zero caveats for this slice.

## Implementation and validation

- TDD RED confirmed the repository module was absent; focused Vitest passes 17/17.
- Added an unwired server-only repository for provider failure and success outcomes. It requires verified admin membership, sets transaction-local RLS identity, locks the target row with `FOR UPDATE OF template`, scopes reads/writes to the verified account and creator profile, validates payloads using the shared template rules, rejects Authentication, and returns only UUID/action.
- Failure persists only `submission_error` and `last_submitted_at`. Success persists editable template fields, sets `PENDING`, clears stale errors/rejection, and leaves name, language, Meta ID, account, user, and trigger-managed timestamps untouched.
- TypeScript, targeted zero-warning ESLint, Prettier, and `git diff --check` passed. PowerShell AST/fixture checks passed.
- Disposable Docker Desktop PostgreSQL 16 integration passed with forced RLS, `NOBYPASSRLS`, exact minimum SELECT/UPDATE column grants, success/failure outcomes, editable-state rejection, account/creator isolation, same-row serialization, constraint rollback, pooled identity cleanup, synthetic data only, `--network none`, tmpfs, read-only mounts, and no residual resources. Final evidence: `validation-postgres-template-edit-persistence-6a79118ac3.log`. An earlier post-probe found the fixture had not fixed `created_at`; that failure is preserved in `validation-postgres-template-edit-persistence-594067e0f3.log`, then the fixture and probe passed on rerun.
- Fresh independent GPT-6 Luna read-only review returned exact `APPROVE`, zero findings, and zero caveats, limited to this unwired edit-persistence repository. Route wiring and H-DATA-003/H-DB-003 overall remain unapproved. Final evidence log records the result. Task remains `in_progress`.

## Next action

Proceed to task `postgres-template-delete-persistence`, isolating the local delete after provider outcome. Keep both lifecycle routes unwired; do not call any provider. This task remains `in_progress`.
