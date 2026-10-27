# Task — PostgreSQL account rename repository

- id: `20261019-220632-41dc`
- type: migration
- slug: `postgres-account-rename-repository`
- status: `in_progress`
- roadmap: H-DATA-003, phase 03

## Goal

Implement the account-rename write in a server-only PostgreSQL repository, scoped to the account and role derived from a verified server session.

## Context

The account-member repository slice passed independent read-only review with `APPROVE`, limited to that slice. H-SELF-002 verified-session provider/policy remains unimplemented, so this repository stays unwired. The existing Supabase-backed route and its name validation stay unchanged. Validation uses synthetic PostgreSQL in disposable Docker Desktop only.

## In scope

- Server-only account repository using the default PostgreSQL guard and requiring `admin` or higher.
- Parameterized update by the guarded account ID, transaction-local RLS identity, and returned account id/name.
- Preserve the existing DB `updated_at` trigger behavior in a fixture shaped from migrations 001/017.
- Focused unit tests and two-account Docker PostgreSQL RLS proof; record exact results and boundaries.

## Out of scope

- Wiring/changing routes/pages or Supabase clients; changing Auth/session policy.
- Account/member/invitation operations beyond rename, other repositories, schema/grant/RLS migration, Storage, Realtime, real credentials/data, existing Docker resources, production, stage, commit, push, deploy, reset, clean, or branch changes.

## Validation

- Focused Vitest: admin rename parameter binding, forbidden lower role, missing session, and not-found/error handling.
- `powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\testing\validate-postgres-account-rename.ps1` — synthetic PostgreSQL 16 two-account RLS proof.
- `node node_modules/typescript/bin/tsc --noEmit`, targeted ESLint (`--max-warnings=0`), Prettier check, and `git diff --check`.

## Next action

Proceed to the next narrow PostgreSQL account repository slice: list outstanding account invitations without exposing `token_hash`. Keep this task `in_progress`; account route wiring remains gated on a separately approved verified-session provider.

## Implementation and validation update

- Added server-only PostgreSQL account rename repository. It requires `admin` or higher via the default account guard, sets `request.jwt.claim.sub` transaction-locally, and updates only the verified membership account ID with bound parameters. It returns ID/name, maps no visible row to `not_found`, and preserves database failure handling.
- Unit tests cover missing session, admin authorization, lower-role denial before update, account ID/name parameter binding, RLS/no-row behavior, and database error propagation.
- Focused Vitest passed 42/42 across account repository, account guard, and role tests. TypeScript passed; targeted ESLint passed with zero warnings; Prettier check passed.
- Disposable Docker Desktop PostgreSQL 16 integration passed using synthetic accounts/users, `NOBYPASSRLS` runtime role, `--network none`, tmpfs, read-only repository mounts, no published ports or named volumes. It verified account-local rename, viewer denial, unchanged second account, the `updated_at` trigger, no-session denial, and transaction-local identity cleanup. Evidence: `.harness/tasks/20261019-220632-41dc/validation-postgres-account-rename-f3e7753de3.log`.
- Scope remains limited to the repository slice. No Supabase, Auth/session policy, route wiring, permanent grants/RLS/schema changes, Storage, Realtime, application traffic, or production was used. No commit/push/deploy occurred.

## Independent read-only review

- Same-model Luna reviewer returned `APPROVE`, zero findings and zero caveats for this account-rename repository slice only.
- Reviewer confirmed `main`, expected HEAD, and status `in_progress`; verified the repository uses the guard-derived identity/account, requires `admin` or higher, binds SQL values, and relies on account-scoped RLS. Unit/integration evidence covers role denial, two-account isolation, `updated_at`, and transaction-local identity cleanup.
- Review was read-only and ran no tests. This does not approve the HARNESS task, route wiring, session provider, Supabase/Auth replacement, grants, Storage, Realtime, application traffic, or production.
