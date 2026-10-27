# Task — PostgreSQL account invitation revocation repository

- id: `20261019-222508-5090`
- type: migration
- slug: `postgres-account-invitation-revoke-repository`
- status: `in_progress`
- roadmap: H-DATA-003, phase 03

## Goal

Implement only the PostgreSQL delete for revoking an invitation, scoped to the verified caller's account and preserving the existing not-found behavior.

## Context

Account invitation read and create repository slices received independent same-model Luna `APPROVE`, each limited to its slice. Existing DELETE route uses Supabase RLS and maps zero visible rows to 404; it remains unchanged. H-SELF-002 verified-session provider/policy and H-DB-003 operation grants remain unapproved. Use disposable PostgreSQL in Docker Desktop only; no Supabase.

## In scope

- Require `admin` or higher through the default PostgreSQL account guard.
- Delete by bound invitation ID and guard-derived account ID; return whether exactly one visible row was deleted.
- Preserve hard-delete semantics and avoid leaking cross-account invitation existence.
- Focused unit tests and a synthetic two-account forced-RLS PostgreSQL integration proof.

## Out of scope

- Wiring/changing routes/pages; Supabase service/client; Auth/session provider/policy.
- Invitation creation/listing/redemption, token handling, migrations, permanent grants/RLS changes, email/notifications.
- Storage, Realtime, real credentials/data, existing Docker resources, app traffic, production, stage, commit, push, deploy, reset, clean, or branch changes.

## Validation

- Added `revoke` to the server-only invitations repository. It requires admin+, sets verified identity transaction-locally, deletes only by bound invitation/account IDs, and returns `false` for missing or cross-account rows so the existing route can preserve 404 behavior.
- TDD RED failed 6/6 because `revoke` was absent; after implementation, focused Vitest passed 38/38 across six account repository/guard files. TypeScript passed; targeted ESLint passed with zero warnings; Prettier check passed.
- Disposable Docker Desktop PostgreSQL 16 integration passed using synthetic invitations/two accounts, `NOBYPASSRLS`, `--network none`, tmpfs, read-only repository mounts, no published ports or named volumes. It verified admin enforcement, account scope, hard-delete, missing/cross-account behavior, two-account isolation, missing-session denial, and transaction-local identity cleanup. Evidence: `validation-postgres-account-invitation-revoke-50f70d10e3.log`.
- Run final `git diff --check` and whitespace checks for SQL/PowerShell files before review.

## Next action

Continue with the next narrow H-DATA-003 account repository slice. Keep this task `in_progress` and existing route unwired.

## Independent read-only review

- Same-model Luna returned `APPROVE`, zero findings and zero caveats, limited to this invitation-revoke repository slice.
- Reviewer confirmed `main`, expected HEAD, and task `in_progress`; checked admin+, bound invitation ID and guard-derived account scope, hard-delete behavior, no-row result for missing/cross-account IDs, and successful disposable PostgreSQL proof.
- This does not approve the whole HARNESS task, route wiring, H-DB-003 grants, H-SELF-002 session provider/policy, Auth, Storage, Realtime, application traffic, or production.
