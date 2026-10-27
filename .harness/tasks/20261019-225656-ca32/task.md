# Task — PostgreSQL invitation redemption repository

- id: `20261019-225656-ca32`
- type: migration
- slug: `postgres-invitation-redemption-repository`
- status: `in_progress`
- roadmap: H-DATA-003, phase 03

## Goal

Add only a PostgreSQL repository wrapper for migration 019's existing `public.redeem_invitation` RPC.

## Context

The invitation-preview repository slice received independent same-model Luna `APPROVE`, limited to that slice. The existing SECURITY DEFINER RPC locks the invitation, checks caller/account state and all 11 domain-data tables, then moves the profile, accepts the invitation, and deletes the caller's empty personal account atomically. Use PostgreSQL in task-owned disposable Docker Desktop resources only; no Supabase.

## In scope

- Require a verified caller with an existing PostgreSQL account profile through the existing guard.
- Accept only a 64-character hexadecimal SHA-256 token digest; set the verified identity transaction-locally and bind the digest to the existing RPC.
- Validate the returned account UUID and translate only safe SQLSTATEs to existing application errors.
- Focused unit tests and a synthetic PostgreSQL integration covering success, invalid/replayed invitations, conflicts, and refusal without deleting or changing protected data in any guarded domain table.

## Out of scope

- Route/page wiring, Supabase, Auth/session provider or policy implementation, token utility changes, migration/RPC edits, permanent grants/RLS changes, or direct repository writes to profiles, invitations, accounts, or domain tables.
- Storage, Realtime, real credentials/data, existing Docker resources, app traffic, production, stage, commit, push, deploy, reset, clean, or branch changes.
- H-DB-003, H-SELF-002, or overall HARNESS approval.

## Validation

- Focused Vitest for verified-session enforcement, malformed digests, bound RPC input, UUID validation, and safe error mapping.
- Disposable PostgreSQL 16 Docker with synthetic data, `--network none`, tmpfs, read-only mounts, no ports/named volumes; temporary fixture reproduces migration 019's RPC semantics and all 11 domain guards.
- TypeScript, targeted ESLint (`--max-warnings=0`), Prettier check, `git diff --check`, SQL/PowerShell whitespace checks, and no residual task containers.

## Next action

Select the next safe PostgreSQL repository slice from the approved project plan. Leave routes unwired and this task `in_progress`.

## Implementation and validation

- Added `src/lib/repositories/invitation-redemption.ts`. It requires an existing verified account context, accepts only a 64-character hexadecimal digest, binds its lowercase value to `public.redeem_invitation($1::text)`, sets `auth.uid()` identity transaction-locally, validates the returned UUID, and delegates every write and the 11-table no-data-loss check to migration 019's RPC. No route, migration, or direct domain write changed.
- Added a safe `bad_request` application error mapping for SQLSTATE `22023`; existing `23505` maps to `conflict`. No database message is exposed. Unit coverage rejects unauthenticated callers, malformed digests, malformed RPC rows, and checks bound input and safe mappings.
- TDD RED confirmed the repository module was absent and `22023` mapped to `db_error`. Final focused Vitest passed 91/91 across 12 account guard/repository and DB files. TypeScript, targeted ESLint with zero warnings, Prettier, PowerShell parser, and task-file whitespace checks passed.
- Disposable PostgreSQL 16 Docker integration passed using synthetic accounts/invitations/domain rows, `NOBYPASSRLS`, no direct invitation/domain table grants, `--network none`, tmpfs, read-only mounts, no ports or volumes. It verified success, replay/expired/used/unknown results, shared/same-account conflicts, all 11 protected domain-data refusals, state preservation, and transaction-local identity cleanup. Evidence: `.harness/tasks/20261019-225656-ca32/validation-postgres-invitation-redemption-252f5dda1d.log`; no task containers remain.
- Two interim Docker runs exposed test-fixture issues (a profile read without RLS identity and non-hex seed characters); both were corrected. Failed logs remain alongside the final successful evidence.
- Route stays unwired and task remains `in_progress`. Supabase, Auth/session provider/policy, H-DB-003, Storage, Realtime, app traffic, and production remain out of scope.

## Independent read-only review

- Same-model Luna returned `APPROVE`, zero findings and zero caveats, limited to this repository slice.
- Reviewer checked branch/HEAD/task status, verified-session guard, digest-only bound RPC input, transaction-local identity, RPC-owned writes, migration 019 parity, all 11 domain guards, state-preservation assertions, and final Docker evidence.
- This approval does not cover route wiring, Auth/session provider or policy, H-DB-003, Storage, Realtime, application traffic, production, or overall HARNESS approval.
