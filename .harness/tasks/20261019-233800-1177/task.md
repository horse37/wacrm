# Task — PostgreSQL paginated contact-list read repository

- id: `20261019-233800-1177`
- type: migration
- slug: `postgres-contact-page-read-repository`
- status: `in_progress`
- roadmap: H-DATA-003, phase 03

## Goal

Add a server-only PostgreSQL paginated contact-list read with exact count and the current name/phone/email search fields.

## Context

H-DATA-003 prioritizes conversations/messages before contacts/tags/custom fields. Account/profile, WhatsApp config, message-history, and conversation-list repository slices received independent Luna approvals limited to their scope. Existing Supabase-backed consumers remain unwired pending H-SELF-002 and H-DB-003. PostgreSQL in task-owned disposable Docker Desktop only; no Supabase.

## In scope

- Require verified account membership for any account role, set identity transaction-locally, and query only the guard-derived account.
- Return existing `Contact` fields for one page and exact total count from one statement snapshot.
- Preserve case-insensitive substring search across `name`, `phone`, and `email`, with parameterized SQL and literal wildcard escaping.
- Preserve descending `created_at` ordering (nulls first) and add a stable ID tie-break for paging.
- Focused unit tests and synthetic forced-RLS PostgreSQL Docker integration for account isolation, projection, search, exact counts, empty pages, and pooled identity cleanup.

## Out of scope

- Route/page wiring, Supabase, Auth/session provider or policy, contact mutations/import/delete, tags, custom fields, Realtime, migrations, permanent grants/RLS, real data/credentials, existing Docker resources, app traffic, production, commit, push, deploy, reset, clean, rebase, or branch changes.

## Validation

- Focused Vitest, TypeScript, targeted ESLint (`--max-warnings=0`), Prettier, PowerShell AST/fixture whitespace checks, and `git diff --check`.
- Disposable PostgreSQL 16 Docker with synthetic accounts/profiles/contacts, forced RLS, runtime `NOBYPASSRLS`, `--network none`, tmpfs, read-only mounts, no ports/named volumes, and cleanup assertion.

## Next action

Implementation and focused validation are complete. Same-model Luna read-only review returned APPROVE with zero findings and caveats for this contact-list repository slice only. Keep this task `in_progress` and consumers unwired; proceed to the next H-DATA-003 repository read slice: tags.

## Boundaries

This slice does not approve H-DATA-003 overall, route/UI migration, H-SELF-002, H-DB-003, Auth/session, permanent RLS/grants, contact writes, tags/custom fields, Realtime, Storage, traffic, or production.

## Implementation and validation

- TDD RED confirmed the repository module was absent. Added `src/lib/repositories/contact-list.ts`; `listPage()` requires verified membership for all roles, sets transaction-local identity, binds the verified account ID, and reads one exact count plus requested page from a single materialized CTE statement snapshot. It maps only the existing `Contact` contract, validates fields and account scope, preserves `created_at DESC NULLS FIRST`, and stabilizes paging by contact ID.
- Search is trimmed, case-insensitive substring matching on name, phone, and email. All values are bound; `%`, `_`, and backslash are escaped so search text stays literal. Invalid page/page-size values fail with a safe `bad_request`.
- The first Docker attempt exposed an invalid SQL `ESCAPE` literal caused by JavaScript template-string escaping. A regression assertion failed before the minimal fix; the final focused test run passed 26/26 across contact list, conversation list, message history, and account guard. TypeScript, targeted ESLint (`--max-warnings=0`), Prettier check, PowerShell AST, fixture/script whitespace, and `git diff --check` passed.
- Final disposable PostgreSQL 16 Docker integration passed with synthetic accounts/profiles/contacts, forced RLS, runtime `NOBYPASSRLS`, `--network none`, tmpfs, read-only mounts, no ports/named volumes, and `PG_POOL_MAX=1`. It verified exact page counts including past-end pages, stable order, viewer access, account isolation, literal wildcard and case-insensitive email search, generated phone normalization, invalid pagination, no session, fail-closed RLS, and transaction-local identity cleanup. Evidence: `.harness/tasks/20261019-233800-1177/validation-postgres-contact-list-315187ad74.log`; earlier failure logs are preserved; cleanup reported no residual resources.
- No route/page wiring, Supabase, contact writes/import/delete, tags/custom fields, Auth/session, migrations, permanent grants/RLS, Realtime, real data/credentials, app traffic, or production were touched.

## Independent read-only review

- Same-model Luna read-only review: APPROVE, zero findings and zero caveats for this contact-list repository slice only. The reviewer verified task scope/status, main/expected HEAD, parameter binding, literal wildcard escaping, same-statement count/page behavior including empty pages, focused tests, and final disposable PostgreSQL integration evidence. H-DATA-003 overall remains unapproved; no route/UI wiring, Supabase/Auth, mutations/grants, traffic, or production were reviewed or approved.
