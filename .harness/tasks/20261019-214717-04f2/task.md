# Task — PostgreSQL account and role guard contract

- id: `20261019-214717-04f2`
- type: migration
- slug: `postgres-account-role-guard`
- status: `in_progress`
- roadmap: H-DATA-002, phase 03

## Goal

Add a server-only, provider-neutral guard contract that derives account membership from a verified server session, reads the matching profile/account from PostgreSQL, and enforces the existing role hierarchy.

## Context

The owner selected PostgreSQL in disposable Docker Desktop and excluded Supabase. The existing `src/lib/auth/account.ts` is Supabase-backed and has active route/page consumers. The H-SELF-002 session provider and application session policy are not yet implemented/approved, so this task will not wire or replace those consumers.

## In scope

- A server-only account membership lookup against the existing `public.profiles` / `public.accounts` schema, parameterized by a user ID supplied by a verified-session resolver.
- `requireAccount()` and `requireRole(minRole)` guards assembled from server-only session and PostgreSQL membership dependencies.
- Fail-closed handling for absent session, missing/invalid membership, invalid role, and insufficient role.
- Focused tests, cross-account denial against disposable Docker PostgreSQL, and exact validation evidence.
- Document rule that domain reads/writes require an explicit account predicate; route/repository migration remains separate.

## Out of scope

- Selecting or implementing Auth/session policy, wiring current Supabase-backed routes/pages, or using Supabase local/remote/real.
- Migrating domain repositories/consumers, changing RLS/migrations/grants, Storage, Realtime, production, real data/credentials, existing Docker resources, stage, commit, push, deploy, reset, clean, or branch changes.

## Validation

- TDD RED: initial guard test failed because `postgres-account-guard.ts` did not exist; after implementation, focused tests passed.
- TDD RED for transaction-local RLS identity: after changing the repository to require an identity GUC, one test failed because the implementation still used `queryDb`; the test then passed after moving the read into `withTransaction` and setting the GUC first.
- `node node_modules/vitest/vitest.mjs run src/lib/auth/postgres-account-guard.test.ts src/lib/auth/roles.test.ts` — SUCCESS, 36/36.
- `node node_modules/typescript/bin/tsc --noEmit` — SUCCESS.
- `node node_modules/eslint/bin/eslint.js --max-warnings=0 src/lib/auth/postgres-account-guard.ts src/lib/auth/postgres-account-guard.test.ts scripts/testing/postgres-account-guard-integration.mjs` — SUCCESS, zero warnings/errors.
- Prettier check on changed TS/MJS and task/project docs — SUCCESS.
- `powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\testing\validate-postgres-account-guard.ps1` — SUCCESS. Evidence: `validation-postgres-account-guard-2b84013215.log`; PostgreSQL 16 Docker `--network none`, tmpfs, `--rm`, read-only repository, no ports/named volumes; fixture used synthetic data, a `NOBYPASSRLS` runtime role, explicit test-only SELECT grants, RLS, cross-account denial, role denial, missing membership, and transaction-local identity cleanup. No residual task containers.
- `git diff --check` — SUCCESS; Git emitted only existing line-ending normalization warnings.

## Independent review remediation — P2

- First independent read-only review returned `REMEDIATION_REQUIRED`: exported `findPostgresAccountMembershipByUserId(userId)` accepted an arbitrary ID and set the RLS identity GUC. Made this database lookup private; default construction remains through `createDefaultPostgresAccountGuards(getVerifiedSession)`.
- Replaced direct lookup coverage with a test through the default guard. It verifies transaction-local identity and membership query binding both use the server-verified session user ID.
- Post-fix focused Vitest — SUCCESS, 36/36: `node node_modules/vitest/vitest.mjs run src/lib/auth/postgres-account-guard.test.ts src/lib/auth/roles.test.ts`.
- Post-fix TypeScript, targeted ESLint (`--max-warnings=0`), and Prettier check — SUCCESS.
- Post-fix disposable PostgreSQL proof — SUCCESS; evidence `validation-postgres-account-guard-00e3c78e41.log` (PostgreSQL 16, `--network none`, tmpfs, read-only repository, synthetic data, no residual task resources).
- Independent read-only re-review returned `APPROVE`, zero findings/caveats, for this guard slice. Task remains `in_progress`; this is not approval of H-DATA-002 as a whole.

## Independent read-only re-review — P2 closure

- The same-model Luna reviewer returned `APPROVE`, zero findings, and zero caveats for this H-DATA-002 guard slice.
- Reviewer verified the raw lookup is private, the default guard binds both RLS identity and membership query to the verified-session resolver, and the post-fix validation evidence is recorded.
- Review was read-only and did not run tests. Branch is `main`, HEAD is `7db4abf47dbc94a732f3ab67ac4d53ba660c9a2c`.
- Approval is limited to this guard slice. The HARNESS task remains `in_progress`; H-SELF-002 session provider/policy, H-DB-003 deployment grants/context, consumers, Supabase/Auth migration, and production are not approved.

The integration uses a task-owned minimal fixture shaped from migration 017 and its `auth.uid()` compatibility convention; it does not execute the 27-migration chain, validate an Auth provider, or establish production role grants. The temporary compatibility function and grants existed only inside the disposable cluster.

## Next action

Guard slice received independent read-only `APPROVE` after P2 remediation. Continue with a separate H-DATA-003 repository slice using PostgreSQL in disposable Docker Desktop. Keep this task `in_progress`; do not wire consumers until H-SELF-002 supplies an approved verified-session provider/policy and H-DB-003 approves the least-privilege account lookup grants/context for the deployment role.

## Implemented slice

- `src/lib/auth/postgres-account-guard.ts` accepts only a server-side verified-session resolver, loads the profile/account by bound `user_id`, checks returned identity and role, and provides `requireAccount()` / `requireRole(minRole)`.
- Membership SQL executes within `withTransaction`; it sets the existing `auth.uid()` claim GUC transaction-locally before querying, preserving current RLS behavior and preventing identity from leaking through a pooled connection.
- `docs/project-map.md` now records the invariant: every account-owned domain read/write must include the verified account scope in SQL.
- Existing Supabase-backed `account.ts` and its consumers are untouched. No provider is wired, no database migration or permanent grant changed, and no task-wide/H-DATA-002 completion is claimed.
