# Task — PostgreSQL account member role repository

- id: `20261019-222944-b638`
- type: migration
- slug: `postgres-account-member-role-repository`
- status: `in_progress`
- roadmap: H-DATA-003, phase 03

## Goal

Add only the server-side PostgreSQL repository operation for changing a non-owner member's role within the verified caller's account.

## Context

Account/member read, rename, invitation list/create/revoke slices received independent same-model Luna `APPROVE`, each limited to its slice. Existing route delegates to `public.set_member_role` from migration 018. H-SELF-002 session provider/policy and H-DB-003 operation grants remain unapproved; the route remains unwired. Use only disposable PostgreSQL Docker Desktop; do not use Supabase local or remote.

## In scope

- Require `admin` or higher through the default PostgreSQL account guard.
- Set verified `auth.uid()` transaction-locally and call existing `public.set_member_role` with bound target user ID and non-owner role.
- Reject self-change, owner/invalid target roles, and missing/cross-account/owner targets before the RPC without revealing cross-account existence.
- Keep the RPC as final authorization; use the current database abstraction's safe generic mapping for unexpected SQL failures.
- Unit tests and synthetic two-account forced-RLS PostgreSQL Docker integration.

## Out of scope

- Wiring/changing routes/pages; Auth/session provider/policy; Supabase service/client.
- Changing migration 018 RPC source, permanent grants/RLS/schema, member removal, ownership transfer, or other repository operations.
- Storage, Realtime, real credentials/data, existing Docker resources, app traffic, production, stage, commit, push, deploy, reset, clean, or branch changes.

## Validation

- Focused Vitest for missing session, admin enforcement, self/owner/invalid-role/target rejection, bound RPC arguments, and database failures.
- Disposable PostgreSQL 16 Docker with synthetic two-account profiles, `NOBYPASSRLS`, `--network none`, tmpfs, read-only mounts, no published ports/named volumes; temporary fixture RPC only.
- TypeScript, targeted ESLint with zero warnings, Prettier check, `git diff --check`, and SQL/PowerShell whitespace checks.

## Next action

Focused/static/PostgreSQL validations and final diff/whitespace checks have passed after the UUID normalization fix. Next: same-model Luna read-only re-review; remediate until `APPROVE` with zero findings/caveats. Keep task `in_progress` and route unwired.

## Implementation and validation

- Added a server-only `setRole` repository wrapper. It requires admin+, rejects self/owner/invalid role and malformed target IDs, hides missing and cross-account targets as `not_found`, sets verified identity transaction-locally, and calls the existing `public.set_member_role` function with bound arguments. Existing migration 018 and route remain unchanged.
- TDD RED failed because the repository module did not exist. After remediation, focused Vitest passed 46/46 across seven account repository/guard files; TypeScript passed; targeted ESLint passed with zero warnings; Prettier check passed.
- Disposable PostgreSQL 16 Docker integration passed after remediation with synthetic two-account profiles, a `NOBYPASSRLS` runtime role, `--network none`, tmpfs, read-only mounts, no published ports/named volumes. The temporary fixture function mirrors migration 018's role-change contract; integration verified admin enforcement, scope isolation, owner/self restrictions, role change, missing-session denial, and transaction-local identity cleanup. Final evidence: `validation-postgres-account-member-role-28353dc437.log`.
- An initial integration attempt returned generic `db_error`; after removing row locks from the read preflight, the final run above passed. The final repository relies on the existing RPC for authoritative authorization.

## Review remediation

- First independent Luna review returned `REMEDIATION_REQUIRED` with one P2: self-user comparison was case-sensitive for hexadecimal UUID text, allowing an uppercase self ID to reach the RPC.
- Added case-normalized UUID comparison and a regression test using an uppercase self ID. TDD check failed before the fix because the call incorrectly resolved. All focused, static, formatting, and Docker validations passed after the fix; independent Luna re-review is pending.

## Independent read-only re-review

- Same-model Luna re-review returned `APPROVE`, zero findings and zero caveats, limited to this repository slice. It confirmed the prior UUID finding is closed and the disposable PostgreSQL evidence matches the slice.
- The task remains `in_progress`; route wiring, H-SELF-002, H-DB-003, Auth, and production remain outside this approval.
