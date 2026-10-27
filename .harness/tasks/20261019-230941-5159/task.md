# Task — PostgreSQL WhatsApp config read repository

- id: `20261019-230941-5159`
- type: migration
- slug: `postgres-whatsapp-config-read-repository`
- status: `in_progress`
- roadmap: H-DATA-003, phase 03

## Goal

Add a server-only PostgreSQL read for current account WhatsApp connection details, returning only the encrypted token and fields required by the existing connection check.

## Context

H-DATA-003 prioritizes `whatsapp_config` after account/profile repositories. Account, Auth, and invitation repository slices remain unwired pending H-SELF-002 and H-DB-003. Use PostgreSQL in task-owned disposable Docker Desktop only; no Supabase.

## In scope

- Require an existing verified account membership; preserve existing read access for every account role.
- Set verified identity transaction-locally and select only `phone_number_id`, encrypted `access_token`, and `status`, using the guard-derived account ID.
- Reject duplicate or invalid rows safely; return `null` when no configuration exists.
- Focused unit and synthetic forced-RLS PostgreSQL Docker integration proving account isolation and pooled identity cleanup.

## Out of scope

- Route/page wiring, Auth/session implementation, Supabase, Meta API calls, token decryption, writes/deletes/registration, other WhatsApp repositories, migrations, permanent grants/RLS, Storage, Realtime, real credentials/data, existing Docker resources, app traffic, production, commit, push, deploy, reset, clean, or branch changes.

## Validation

- Focused Vitest, TypeScript, targeted ESLint (`--max-warnings=0`), Prettier, and `git diff --check`.
- Disposable PostgreSQL 16 Docker with synthetic accounts/config rows, runtime `NOBYPASSRLS`, `--network none`, tmpfs, read-only mounts, no ports/named volumes, and no residual task resources.

## Next action

Request independent same-model Luna read-only review of this repository slice and evidence. Keep the repository unwired and this task `in_progress`.

## Implementation and validation

- Added `src/lib/repositories/whatsapp-config.ts`. `getConnectionConfig()` requires verified membership for any existing account role, transaction-locally sets the verified identity, scopes the query to the guard-derived account ID, and selects only `phone_number_id`, encrypted `access_token`, and `status`. It returns `null` when absent and safely rejects duplicate or malformed rows. It does not decrypt or log token material.
- Added focused tests for missing session, viewer access, bound account scope, excluded columns, absent config, duplicate rows, invalid status/token, and safe DB errors. Vitest passed 15/15 across the repository test and account-guard test files. TypeScript, targeted ESLint (`--max-warnings=0`), Prettier check, PowerShell AST parsing, and `git diff --check` passed.
- Disposable PostgreSQL 16 Docker integration passed with synthetic accounts/config only, forced RLS, runtime `NOBYPASSRLS`, `--network none`, tmpfs, read-only source mounts, no ports/named volumes, and `PG_POOL_MAX=1`. It proved viewer read access, cross-account denial, missing-config behavior, no-session denial, fail-closed RLS, and transaction-local identity cleanup. Evidence: `.harness/tasks/20261019-230941-5159/validation-postgres-whatsapp-config-2f4803ec0a.log`; no task resources remain.
- No route, page, Meta call, token decryption, write, delete, migration, permanent grant, or Supabase use changed. H-SELF-002, H-DB-003, Storage, Realtime, traffic, and production remain out of scope.

## Independent read-only review

- Same-model Luna returned `APPROVE`, zero findings, and zero caveats, limited to this repository slice.
- Reviewer verified `main` and expected HEAD, task `in_progress`, verified account membership, guard-derived bound account scope, transaction-local identity, selected-field boundary, RLS fixture, and successful Docker evidence. Review ran no tests and made no edits.
- Approval does not cover route wiring, Auth/session, H-DB-003, Supabase, Storage, Realtime, traffic, production, or overall HARNESS approval.
