# Task — PostgreSQL contact deal-list read repository

- id: `20261020-001344-ebac`
- type: `migration`
- slug: `postgres-contact-deal-list-read`

## Goal

Add a server-only PostgreSQL repository to list deals for one contact in the verified account.

## Context

H-DATA-003 phase 03. Use task-owned disposable PostgreSQL in Docker Desktop; do not use Supabase. Consumer wiring stays pending H-SELF-002 and H-DB-003.

## In scope

- Require verified account membership; validate contact UUID; set transaction-local RLS identity.
- Read deals for that contact with explicit verified-account scope and same-account contact, pipeline, and stage joins.
- Map the existing `Deal` projection, including safe NUMERIC(12,2) conversion, newest-first with stable ID tie-break.
- Focused tests and synthetic forced-RLS PostgreSQL proof for projection, parent/account isolation, ordering, empty results, bad IDs/no session, fail-closed RLS, and pooled identity cleanup.

## Out of scope

No UI/route wiring, Supabase/Auth replacement, deal writes, nested contact/stage/assignee hydration, schema/grant/RLS changes, other repositories, Realtime, real data/credentials, existing Docker resources, traffic, production, commit, push, deploy, reset, clean, rebase, or branch changes.

## Validation

- Focused Vitest, TypeScript, targeted zero-warning ESLint, Prettier, PowerShell fixture/script checks, and `git diff --check`.
- Disposable PostgreSQL 16 with synthetic forced-RLS fixtures, runtime `NOBYPASSRLS`, `--network none`, tmpfs, read-only mounts, no ports/named volumes, and cleanup assertion.

## Next action

Fresh independent same-model GPT-6 Luna read-only review of this contact-deal slice; keep task `in_progress` and consumers unwired.

## Results

- TDD RED confirmed the repository was absent. Added `src/lib/repositories/contact-deal-list.ts` with verified-account guard, transaction-local RLS identity, UUID validation, explicit account scope, same-account contact/pipeline joins, stage-to-pipeline consistency, flat `Deal` projection, bounded `NUMERIC(12,2)` conversion, and newest-first stable ID order.
- Focused repository and account-guard Vitest passed 13/13; TypeScript, targeted ESLint (`--max-warnings=0`), Prettier, PowerShell AST/fixture whitespace, and `git diff --check` passed.
- Disposable PostgreSQL 16 Docker forced-RLS integration passed with synthetic data, runtime `NOBYPASSRLS`, `--network none`, tmpfs, readonly mounts, no ports/named volumes, and no residual task resources. Mapping/order, account/contact/pipeline/stage isolation, viewer, empty result, invalid/no-session, fail-closed RLS, and pooled identity cleanup passed. The initial evidence log predates the review remediation below.
- No Supabase, consumer wiring, Auth/session changes, deal writes, schema/grants/RLS changes, real data, traffic, or production were touched.

## Independent review remediation

- First fresh Luna read-only review found one P2: PostgreSQL `DATE` decoding to a local `Date` then converting to UTC could shift `expected_close_date` by one day in UTC+ timezones.
- The query now formats the date as ISO text with `to_char(..., 'YYYY-MM-DD')`; mapping validates and preserves that date-only string. The disposable Node runner sets `TZ=Pacific/Kiritimati` to exercise the UTC+14 case.
- Post-fix focused Vitest passed 13/13; TypeScript, targeted zero-warning ESLint, Prettier, PowerShell AST/fixture whitespace, and `git diff --check` passed. The fresh forced-RLS Docker run passed with no residual resources. Final evidence: `.harness/tasks/20261020-001344-ebac/validation-postgres-contact-deal-list-6112eaba56.log`.
- Fresh independent same-model Luna re-review returned `APPROVE`, zero findings, and zero caveats, limited to this contact-deal read slice. Task stays `in_progress`; this is not overall H-DATA-003 approval.
