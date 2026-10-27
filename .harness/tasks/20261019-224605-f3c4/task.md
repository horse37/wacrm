# Task — PostgreSQL account ownership transfer repository

- id: `20261019-224605-f3c4`
- type: migration
- slug: `postgres-account-ownership-transfer-repository`
- status: `in_progress`
- roadmap: H-DATA-003, phase 03

## Goal

Add only the server-side PostgreSQL repository operation for transferring account ownership through the existing `public.transfer_account_ownership` RPC.

## Context

The account member-removal repository slice received independent same-model Luna `APPROVE`, limited to its slice. Existing POST route delegates ownership transfer to migration 018's SECURITY DEFINER function. That function atomically demotes the current owner to admin, promotes the target to owner, and updates `accounts.owner_user_id`. The repository must delegate all writes to it. H-SELF-002 session provider/policy and H-DB-003 grants remain unapproved. Use PostgreSQL in disposable Docker Desktop only; no Supabase.

## In scope

- Require the verified caller to have the `owner` role.
- Validate the target UUID, reject self-transfer, and scope the target preflight to the verified account; hide missing and cross-account targets as `not_found`.
- Set verified `auth.uid()` transaction-locally and call the existing RPC with a bound target UUID.
- Unit tests and synthetic two-account PostgreSQL Docker integration, including atomic role and owner-pointer updates.

## Out of scope

- Wiring/changing routes or pages; session provider/policy, Auth, or Supabase client changes.
- Editing migration 018/RPC source, schema, permanent grants/RLS, or reproducing transfer writes in TypeScript.
- Member removal, role/invitation changes, Storage, Realtime, real credentials/data, existing Docker resources, app traffic, production, stage, commit, push, deploy, reset, clean, or branch changes.

## Validation

- Focused Vitest for no session, non-owner denial, malformed/self/missing/cross-account targets, bound RPC arguments, and database failures.
- Disposable PostgreSQL 16 Docker with synthetic two-account profiles, `NOBYPASSRLS`, `--network none`, tmpfs, read-only mounts, no published ports/named volumes; temporary fixture RPC only.
- TypeScript, targeted ESLint (`--max-warnings=0`), Prettier check, `git diff --check`, SQL/PowerShell whitespace checks, and no residual task containers.

## Next action

Independent same-model Luna read-only review returned `APPROVE`, zero findings/caveats, limited to this slice. Keep the task `in_progress` and route unwired; next is a separate PostgreSQL-only invitation preview repository slice.

## Implementation and validation

- Added server-only `transferTo`, requiring owner, rejecting malformed/self targets, hiding missing/cross-account targets as `not_found`, setting verified identity transaction-locally, and calling existing `public.transfer_account_ownership` with a bound UUID. The RPC remains responsible for the atomic role and owner-pointer updates. Route and migration 018 are unchanged.
- TDD RED failed because the repository module was absent. Focused Vitest passed 61/61 across nine account repository/guard files; TypeScript, targeted ESLint with zero warnings, and final Prettier check passed.
- Disposable PostgreSQL 16 Docker integration passed with synthetic accounts, a `NOBYPASSRLS` runtime role, `--network none`, tmpfs, read-only mounts, no ports/volumes, and no residual resources. It verified owner-only access, self/missing/cross-account restrictions, caller demotion, target promotion, owner pointer, second-account isolation, and identity cleanup. Evidence: `validation-postgres-account-ownership-transfer-3576300ce0.log`.
- `git diff --check` and untracked SQL/JS/PowerShell whitespace checks passed. Initial Prettier findings were corrected; final check passed.

## Independent read-only review

- Same-model Luna returned `APPROVE`, zero findings and zero caveats, limited to this repository slice. The route remains unwired; the HARNESS task remains `in_progress`.
- H-SELF-002, H-DB-003, Auth, Supabase, application traffic, and production were not reviewed or approved.
