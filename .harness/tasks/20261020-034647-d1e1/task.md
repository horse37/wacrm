# Task — PostgreSQL template sync persistence

- id: `20261020-034647-d1e1`
- type: migration
- slug: `postgres-template-sync-persistence`
- roadmap: H-DATA-003, phase 03
- status: `in_progress`

## Goal

Add an unwired server-only PostgreSQL repository that inserts or updates one synthetic template-sync result.

## Context

The sync handler matches by exact account/name/language, updates a single existing row or inserts a new row, and lets PostgreSQL's `set_updated_at` trigger replace `updated_at` on updates. Migration 014 enforces `UNIQUE(user_id, name, language)`; migration 017 makes template insert/update admin-only. The prior isolated sync match read received independent GPT-6 Luna `APPROVE`, limited to that lookup. PostgreSQL in disposable Docker Desktop only; never Supabase.

## In scope

- Define and validate a minimal sync snapshot for one provider result, with no provider call in the repository.
- Require verified admin account membership and transaction-local RLS identity.
- Serialize same-account/name/language operations with a transaction advisory lock; then select the exact match, fail closed on duplicates, update by matched ID and account or insert for the verified account/user.
- Preserve sync semantics: no status filter/default language; existing `header_media_url` is not overwritten on update; generated rows use the supplied update timestamp.
- Return only matched UUID and `inserted`/`updated` action.
- Prove forced RLS, runtime `NOBYPASSRLS`, minimal column SELECT/INSERT/UPDATE grants, constraint behavior, and concurrent idempotent matching in disposable Docker Desktop PostgreSQL 16.

## Out of scope

No route/UI wiring, external provider calls, network traffic, real credentials/data, app traffic, Auth/session replacement, schema/grant/RLS changes, Supabase, production, commit, push, deploy, reset, clean, rebase, or branch change. PostgreSQL writes are permitted only to task-owned synthetic Docker data. Preserve all existing work. Keep this task `in_progress`; H-DATA-003/H-DB-003 remain unapproved overall.

## Validation

Start with failing focused Vitest. Run focused tests, TypeScript, zero-warning targeted ESLint, Prettier, PowerShell AST/fixture checks, `git diff --check`, and disposable Docker Desktop PostgreSQL 16 integration with `--network none`, tmpfs, read-only mounts, generated credentials, exact minimum privileges, forced RLS, concurrent operations, and cleanup verification. Obtain fresh independent GPT-6 Luna read-only review; remediate and repeat until exact `APPROVE`, zero findings, and zero caveats for this repository slice.

## Implementation and validation

- TDD RED confirmed the repository module was absent. The focused suite now passes 17/17.
- Added an unwired server-only repository with verified admin membership, transaction-local identity, same-key advisory locking, account/name/language and creator matching, fail-closed duplicates, parameterized JSONB upsert, explicit account predicates, and ID/action-only output. Updates preserve `header_media_url`; PostgreSQL's trigger controls update timestamps.
- TypeScript, targeted ESLint with zero warnings, and Prettier check passed. PowerShell AST and fixture checks passed; `git diff --check` passed with only preexisting LF-to-CRLF notices.
- Disposable Docker Desktop `desktop-linux` PostgreSQL 16 integration passed with `--network none`, tmpfs, read-only mounts, generated synthetic credentials/data, forced RLS, `NOBYPASSRLS`, exact minimum column privileges, account isolation, duplicate handling, database constraint rollback, concurrent idempotency, media preservation, timestamp trigger, identity cleanup, and no residual task resources.
- Final evidence: `validation-postgres-template-sync-persistence-264fd1579d.log`. It also covers an inconsistent creator row remaining untouched. An earlier run passed the integration but its bootstrap post-probe used unsupported `min(uuid)`; that evidence is preserved in `validation-postgres-template-sync-persistence-a45aa793b7.log`. The probe was corrected and the full validation rerun successfully.
- No route/UI wiring, provider calls, Supabase, real credentials/data, application traffic, production, commit, push, or deploy.

## Independent review

Fresh independent GPT-6 Luna read-only review returned exact `APPROVE`, with zero findings and zero caveats. Approval is limited to this repository slice; it does not approve route wiring or H-DATA-003/H-DB-003 overall.

## Next action

Next task `20261020-035839-2f1e` isolates the submit route's PostgreSQL persistence result while preserving its legacy `(user_id, name, language)` unique key. Keep this task `in_progress`; do not wire routes or contact Meta.
