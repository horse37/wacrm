# Task — PostgreSQL account members repository

- id: `20261019-215941-005d`
- type: migration
- slug: `postgres-account-members-repository`
- status: `in_progress`
- roadmap: H-DATA-003, phase 03

## Goal

Implement the first read-only profile/account repository slice: list members for the account derived from a verified server session, using PostgreSQL only.

## Context

H-DATA-002's guard slice received independent read-only `APPROVE`, limited to that slice. The verified-session provider/policy is not implemented, so the repository will accept an injected server-side resolver and remain unwired. The existing Supabase-backed route remains unchanged. Database validation uses synthetic data in disposable Docker Desktop PostgreSQL only.

## In scope

- Server-only account-members repository using the default PostgreSQL guard.
- Parameterized profile query with an explicit `account_id` predicate and transaction-local identity for existing RLS.
- Preserve the current `AccountMember` projection, including hiding email from agent/viewer roles using caller role from the same profile-query snapshot, and ignoring unknown roles.
- Focused unit tests and two-account Docker PostgreSQL RLS integration; exact validation evidence and handoff.

## Out of scope

- Wiring/changing routes or pages, replacing Supabase Auth or any Supabase client, or selecting session policy.
- Account mutations, role/invitation management, other domain repositories, schema/grants/RLS migrations, Storage, Realtime, app traffic, real credentials/data, existing Docker resources, production, stage, commit, push, deploy, reset, clean, or branch changes.

## Validation

- Focused Vitest for the new repository — verify fail-closed session behavior, account binding, field projection, and database errors.
- `powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\testing\validate-postgres-account-members.ps1` — disposable PostgreSQL 16, synthetic two-account fixture, RLS and pool-context cleanup.
- `node node_modules/typescript/bin/tsc --noEmit` and targeted ESLint (`--max-warnings=0`).
- Prettier check on changed code and task records; `git diff --check`.

## Next action

Obtain independent read-only review of this repository slice. Keep this task `in_progress`; route wiring and remaining repositories stay separate.

## Implemented slice

- Added server-only `createPostgresAccountMembersRepository(getVerifiedSession)`. It resolves account context through the default PostgreSQL guard, sets the verified user identity transaction-locally, and lists profiles with a bound `account_id` predicate and deterministic ordering.
- Returned records preserve the existing `AccountMember` shape. Admin/owner can see member email; agent/viewer receive `null`. Unknown roles are omitted; nullable names/timestamps are normalized to the existing API shape.
- The existing Supabase-backed route is untouched and does not consume this repository. No Auth provider/policy, migration, permanent grant, or RLS policy changed.

## Validation results

- TDD RED: the initial focused Vitest run failed because `src/lib/repositories/account-members.ts` did not exist.
- Focused Vitest — SUCCESS, 41/41: `node node_modules/vitest/vitest.mjs run src/lib/repositories/account-members.test.ts src/lib/auth/postgres-account-guard.test.ts src/lib/auth/roles.test.ts`.
- TypeScript — SUCCESS: `node node_modules/typescript/bin/tsc --noEmit`.
- Targeted ESLint — SUCCESS, zero warnings/errors: `node node_modules/eslint/bin/eslint.js --max-warnings=0 src/lib/repositories/account-members.ts src/lib/repositories/account-members.test.ts scripts/testing/postgres-account-members-integration.mjs`.
- Prettier check on changed TypeScript, MJS and task records — SUCCESS.
- Disposable PostgreSQL integration — SUCCESS; final evidence `validation-postgres-account-members-5501c04534.log` supersedes the earlier successful run. PostgreSQL 16/Node 22, `--network none`, tmpfs, read-only repository mount, synthetic accounts/users, no ports/named volumes, and no residual task resources. It verified two-account RLS isolation, role-sensitive email projection, missing-session denial, and transaction-local identity cleanup.
- Email visibility uses the caller role read in the same SQL statement snapshot as the member rows, avoiding stale role projection after guard resolution.
- `git diff --check` — SUCCESS after final records; Git emitted only existing line-ending normalization warnings. `rg -n '[ \t]+$'` found no trailing whitespace in new SQL/MJS/PowerShell fixture/runner files.
- This does not execute the full migration chain or test actual Auth/session integration, route behavior, other repositories, Supabase, Storage, Realtime, or production. No task-wide H-DATA-003 completion is claimed.

## Independent read-only review

- Same-model Luna reviewer returned `APPROVE`, zero findings, zero caveats for this account-members repository slice.
- Reviewer confirmed explicit parameterized account scope, transaction-local RLS identity, caller role from the same SQL snapshot, role-based email projection, synthetic two-tenant isolation tests, and unchanged Supabase route.
- Review was read-only and did not run tests. Branch is `main`; HEAD remains `7db4abf47dbc94a732f3ab67ac4d53ba660c9a2c`.
- Approval is slice-limited. This HARNESS task remains `in_progress`; H-DATA-003 overall, route wiring, verified-session provider, other repositories, Supabase/Auth replacement, and production are not approved.
