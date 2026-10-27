# Task — PostgreSQL outstanding account invitations repository

- id: `20261019-221317-cbf2`
- type: migration
- slug: `postgres-account-invitations-read-repository`
- status: `in_progress`
- roadmap: H-DATA-003, phase 03

## Goal

Add a server-only PostgreSQL repository for the existing GET operation that lists outstanding invitations in the verified caller's account.

## Context

The account-member listing and account rename repository slices received independent same-model Luna `APPROVE`, each limited to its slice. H-SELF-002 verified-session provider/policy and H-DB-003 operation grants remain unapproved; this repository is injected-session testable and unwired. The existing route and Supabase client stay unchanged. Validate against synthetic PostgreSQL in task-owned disposable Docker Desktop resources only.

## In scope

- Require `admin` or higher through the default PostgreSQL account guard.
- List only the guarded account's pending invitations (`accepted_at IS NULL`, expiry after database current time), ordered newest first with a deterministic tie-breaker.
- Preserve the existing GET response's allowlisted fields; never select or expose `token_hash`.
- Focused unit tests and a two-account forced-RLS PostgreSQL integration proof.

## Out of scope

- Wiring/changing routes or pages; use of Supabase service/client; Auth/session provider or policy.
- Invitation creation, revocation, redemption, token generation, email/notification delivery, role/member mutations, migrations, grants, or RLS changes.
- Storage, Realtime, real credentials/data, existing Docker resources, app traffic, staging, production, commit, push, deploy, reset, clean, or branch changes.

## Validation

- Focused Vitest for missing session, admin authorization, account-bound parameters, pending/expiry filtering, ordering, no token hash projection, and database failures.
- Disposable Docker Desktop PostgreSQL 16 integration: synthetic two-account rows, `NOBYPASSRLS`, `--network none`, tmpfs, read-only repository mount, no published ports or named volumes.
- TypeScript, targeted ESLint with zero warnings, Prettier check for changed code/task records, `git diff --check`, and whitespace check for untracked fixtures/scripts.

## Next action

Proceed to the next narrow PostgreSQL invitation repository slice: creation from validated role/expiry inputs and caller-generated token hash. Keep this task `in_progress`; invitation route wiring stays gated on verified-session integration and separately approved operation grants.

## Implementation and validation update

- Added server-only `createPostgresAccountInvitationsRepository`. It requires `admin` or higher through the default PostgreSQL account guard, sets verified identity transaction-locally, and queries only the guard-derived account ID with bound parameters.
- The query returns the existing GET response fields for pending, unexpired invitations, ordered by creation time and ID descending. It never selects `token_hash`; invalid roles are omitted defensively and PostgreSQL timestamps are normalized to ISO strings.
- TDD RED: initial focused Vitest failed because the repository module did not exist.
- Focused Vitest passed 54/54 across invitations, account/member repositories, account guard, and role tests. TypeScript passed; targeted ESLint passed with zero warnings; Prettier check passed.
- Disposable Docker Desktop PostgreSQL 16 integration passed. The proof uses synthetic two-account rows, a `NOBYPASSRLS` runtime role, `--network none`, tmpfs, read-only mounts, no published ports or named volumes; it verifies admin enforcement, account isolation, accepted/expired filtering, newest-first ordering, token hash exclusion, no-session denial, and identity cleanup. Evidence: `.harness/tasks/20261019-221317-cbf2/validation-postgres-account-invitations-6b9c6b1532.log`.
- Existing Supabase route is untouched/unwired. No invitation writes, Auth/session policy, permanent grants/RLS/schema changes, Storage, Realtime, app traffic, production, commit, push, or deploy occurred.

## Independent read-only review

- Same-model Luna reviewer returned `APPROVE`, zero findings and zero caveats, limited to this outstanding-invitations read slice.
- Reviewer verified branch `main`, expected HEAD, and task status `in_progress`; confirmed admin+ enforcement, account ID bound from the guard, accepted/expired filters, deterministic ordering, token hash exclusion, and successful disposable PostgreSQL 16 isolation proof.
- Review was read-only and ran no tests. This does not approve the HARNESS task, invite writes, route wiring, verified-session provider, grants, Auth/Supabase, Storage, Realtime, app traffic, or production.
