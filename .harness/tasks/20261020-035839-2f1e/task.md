# Task — PostgreSQL template submission persistence

- id: `20261020-035839-2f1e`
- type: migration
- slug: `postgres-template-submit-persistence`
- roadmap: H-DATA-003, phase 03
- status: `in_progress`

## Goal

Add an unwired server-only PostgreSQL repository that persists one template-submission result.

## Context

The current submit route upserts by `(user_id, name, language)` and writes a DRAFT/error row after provider failure or a normalized Meta status after success. Migration 014 defines that user-keyed unique constraint; migration 017 restricts writes to account admins. The template-sync persistence slice has a limited independent GPT-6 Luna APPROVE. Use only disposable PostgreSQL in Docker Desktop; never Supabase.

## In scope

- Validate the submission payload/result snapshot; require verified admin membership and transaction-local RLS identity.
- Preserve the exact per-user unique key and account/profile consistency, parameterized JSONB, and safe ID/action output.
- Persist category, language, content, media URL/handle, buttons/samples, status, Meta ID, submission error, clear stale rejection reason, and last-submitted timestamp.
- Serialize same-account/user/name/language writes and fail closed on malformed/duplicate rows.
- Prove forced RLS, runtime `NOBYPASSRLS`, minimum column grants, same-key concurrency, per-user uniqueness semantics, constraints, and media URL updates in disposable Docker Desktop PostgreSQL 16.

## Out of scope

No route/UI wiring, Meta/provider calls, external network, Auth/session replacement, schema/grant/RLS edits, Supabase, real credentials/data, app traffic, production, commit, push, deploy, reset, clean, rebase, or branch change. Writes only to task-owned synthetic Docker data. Keep this task `in_progress`; H-DATA-003/H-DB-003 remain unapproved overall.

## Validation

Start with failing focused Vitest. Run focused Vitest, TypeScript, zero-warning targeted ESLint, Prettier, PowerShell AST/fixture checks, `git diff --check`, and disposable Docker Desktop PostgreSQL 16 integration with `--network none`, tmpfs, read-only mounts, generated credentials, exact minimum privileges, forced RLS, concurrency, and cleanup verification. Obtain fresh independent GPT-6 Luna read-only review; remediate and repeat until exact `APPROVE`, zero findings, and zero caveats for this slice.

## Implementation and validation

- TDD RED confirmed the repository module was absent; focused Vitest now passes 31/31.
- Added an unwired server-only repository preserving the per-user unique key, success and DRAFT/error outcomes, verified admin guard, transaction-local identity, creator consistency, parameterized JSONB, same-key advisory lock, ID/action-only result, and shared template business validation.
- The first independent review required matching existing template rules. The repository now reuses `validateTemplatePayload`; negative tests cover invalid names, empty/overlong body, invalid media URL, and URL-button limits. PostgreSQL synthetic examples were aligned with the same rules.
- The second independent review required cross-field outcome validation. Provider failure now requires DRAFT, no Meta ID, and a nonempty error; provider success requires a Meta ID and no error, while allowing any normalized status including DRAFT. Negative cases fail before `withTransaction`; a positive DRAFT-with-ID case protects the accepted success status.
- The third independent review required preserving the submit route's unsupported Authentication-category rejection. The repository now rejects it before opening a transaction, with a focused negative case.
- The fourth independent review required advisory-lock identity to equal the legacy unique tuple. The lock now hashes only `(user_id, name, language)`; a focused test confirms account-context changes do not change its key.
- TypeScript, targeted ESLint with zero warnings, Prettier check, and `git diff --check` passed.
- Docker Desktop PostgreSQL 16 integration passed with forced RLS, `NOBYPASSRLS`, exact minimum column grants, per-user same-name behavior, cross-account and creator isolation, constraint rollback, same-key concurrency, transaction-local identity cleanup, synthetic-only data, network none, tmpfs, read-only mounts, and no residual resources. Final evidence: `validation-postgres-template-submit-persistence-8580d82154.log`. Earlier failing integration attempts remain recorded separately in the task directory.
- Fresh independent GPT-6 Luna read-only review returned exact `APPROVE`, zero findings, and zero caveats, limited to this unwired repository slice. It does not approve route wiring or H-DATA-003/H-DB-003 overall. Recorded in the final validation log.
- No route/provider call, Supabase, real data/credentials, app traffic, production, commit, push, or deploy.

## Next action

Task `20261020-042158-7c91` continues with lifecycle edit persistence. Keep this task `in_progress`, the submit route unwired, and H-DATA-003/H-DB-003 unapproved overall.
