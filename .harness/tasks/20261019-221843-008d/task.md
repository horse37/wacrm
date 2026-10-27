# Task — PostgreSQL account invitation creation repository

- id: `20261019-221843-008d`
- type: migration
- slug: `postgres-account-invitation-create-repository`
- status: `in_progress`
- roadmap: H-DATA-003, phase 03

## Goal

Implement only the database insert for creating an account invitation, scoped to the verified caller's account and returning only the existing POST response metadata.

## Context

Outstanding-invitation listing and account/member repository slices received independent same-model Luna `APPROVE`, each limited to its slice. H-SELF-002 verified-session provider/policy and H-DB-003 operation grants remain unapproved; this repository stays unwired. Use PostgreSQL in disposable Docker Desktop only. Existing Supabase routes and token utilities remain unchanged.

## In scope

- Require `admin` or higher through the default PostgreSQL account guard.
- Insert into `public.account_invitations` using account/user IDs from that guard and bound values for role, token hash, label, and expiry.
- Persist only the caller-supplied hash, never plaintext token; never return `token_hash`.
- Preserve the existing POST response metadata fields and SQL uniqueness/error behavior.
- Focused unit tests and a two-account forced-RLS PostgreSQL integration proof.

## Out of scope

- Wiring/changing routes or pages; Supabase service/client; Auth/session provider/policy.
- Token generation/hashing, URL/HTTP responses, invitation listing/revoke/redeem, role/member changes, migrations, permanent grants/RLS changes, email/notification delivery.
- Storage, Realtime, real credentials/data, existing Docker resources, app traffic, production, stage, commit, push, deploy, reset, clean, or branch changes.

## Validation

- Added `create` to the server-only invitations repository. It requires admin+, derives account and actor from the verified guard, rejects owner/invalid roles and malformed hashes, binds all values, persists the caller-provided hash only, and returns only POST metadata. The existing route remains unwired.
- Focused Vitest passed 54/54 across five account repository/guard files; TypeScript passed; targeted ESLint passed with zero warnings; Prettier check passed for changed code and task records.
- Disposable Docker Desktop PostgreSQL 16 integration passed using synthetic two-account fixtures, `NOBYPASSRLS`, `--network none`, tmpfs, read-only repository mounts, no published ports or named volumes. It verified admin enforcement, guard-derived account/user scope, hash-only persistence, metadata-only response, account isolation, missing-session denial, and transaction-local identity cleanup. Evidence: `validation-postgres-account-invitation-create-f709b7d93f.log`.
- SQL/PowerShell/runner fixture files have no trailing whitespace. Run `git diff --check` before review.

## Next action

Continue with the next narrow H-DATA-003 account repository slice. Keep this task `in_progress` and the existing route unwired.

## Independent read-only review

- Same-model Luna returned `APPROVE`, zero findings and zero caveats, limited to this invitation-create repository slice.
- Reviewer confirmed `main`, expected HEAD, and `in_progress`; checked admin enforcement, guard-derived account/actor IDs, bound insert inputs, hash-only persistence, metadata-only response, and successful disposable PostgreSQL integration with account isolation.
- This does not approve the whole HARNESS task, route wiring, H-DB-003 grants, H-SELF-002 session provider/policy, Auth, Storage, Realtime, application traffic, or production.
