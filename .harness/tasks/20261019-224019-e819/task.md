# Task — PostgreSQL account member removal repository

- id: `20261019-224019-e819`
- type: migration
- slug: `postgres-account-member-removal-repository`
- status: `in_progress`
- roadmap: H-DATA-003, phase 03

## Goal

Add only the server-side PostgreSQL repository operation that removes a non-owner member from the caller's account by invoking the existing `public.remove_account_member` RPC.

## Context

The member-role repository slice received independent same-model Luna `APPROVE`, limited to that slice. Existing route calls `remove_account_member` from migration 018. That RPC creates a personal account for the removed user and reassigns their profile as its owner; the repository must preserve this contract and must not reproduce these writes itself. H-SELF-002 session provider/policy and H-DB-003 grants remain unapproved. Use PostgreSQL in disposable Docker Desktop only; no Supabase.

## In scope

- Require `admin` or higher through the default PostgreSQL account guard.
- Validate the target UUID and reject caller self-removal, owner targets, and missing/cross-account targets before the RPC without revealing cross-account existence.
- Set verified `auth.uid()` transaction-locally and invoke the existing RPC with a bound target ID; return its new personal account UUID.
- Unit coverage and synthetic two-account PostgreSQL Docker integration for authorization, account reassignment, and identity cleanup.

## Out of scope

- Wiring/changing routes or pages; session provider/policy, Auth, or Supabase client changes.
- Editing migration 018/RPC source, schema, permanent grants/RLS, or implementing account creation/reassignment in TypeScript.
- Ownership transfer, invitations, role changes, Storage, Realtime, real credentials/data, existing Docker resources, app traffic, production, stage, commit, push, deploy, reset, clean, or branch changes.

## Validation

- Focused Vitest for missing session, admin enforcement, malformed/self/owner/missing/cross-account targets, bound RPC argument, returned personal account ID, and database failures.
- Disposable PostgreSQL 16 Docker with synthetic two-account profiles, `NOBYPASSRLS`, `--network none`, tmpfs, read-only mounts, no published ports/named volumes; temporary fixture RPC only.
- TypeScript, targeted ESLint (`--max-warnings=0`), Prettier check, `git diff --check`, SQL/PowerShell whitespace checks, and no residual task containers.

## Next action

Independent same-model Luna read-only review returned `APPROVE`, zero findings/caveats, limited to this slice. Keep the task `in_progress` and route unwired; continue with a separately scoped ownership-transfer repository.

## Implementation and validation

- Added server-only `removeMember`, requiring admin+, rejecting malformed/self/owner targets, hiding missing and cross-account targets as `not_found`, setting verified identity transaction-locally, and calling existing `public.remove_account_member` with a bound UUID. The wrapper validates and returns the RPC's new personal account UUID; account creation and profile reassignment remain inside the existing RPC. Route and migration 018 are unchanged.
- TDD RED failed because the repository module was absent. Focused Vitest passed 53/53 across eight account repository/guard files; TypeScript, targeted ESLint with zero warnings, and Prettier passed.
- Disposable PostgreSQL 16 Docker integration passed with synthetic accounts, a `NOBYPASSRLS` runtime role, `--network none`, tmpfs, read-only mounts, no ports/volumes, and no residual resources. It verified personal account creation, profile reassignment to owner, caller account stability, role/session denial, owner/self/missing/cross-account restrictions, and identity cleanup. Evidence: `validation-postgres-account-member-removal-bafbf5b07b.log`.
- `git diff --check` and untracked SQL/JS/PowerShell whitespace checks passed. Task/handoff formatting initially needed Prettier; corrected and final Prettier check passed.

## Independent read-only review

- Same-model Luna returned `APPROVE`, zero findings and zero caveats, limited to this repository slice. The route remains unwired, and the HARNESS task remains `in_progress`.
- H-SELF-002, H-DB-003, Auth, Storage, Realtime, application traffic, and production were not reviewed or approved.
