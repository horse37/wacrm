# Task — PostgreSQL invitation preview repository

- id: `20261019-225101-d76a`
- type: migration
- slug: `postgres-invitation-preview-repository`
- status: `in_progress`
- roadmap: H-DATA-003, phase 03

## Goal

Add only a PostgreSQL repository read for the existing public `public.peek_invitation` RPC, using a caller-supplied SHA-256 token hash and returning the fixed preview contract.

## Context

The account ownership-transfer repository slice received independent same-model Luna `APPROVE`, limited to its slice. Existing GET route hashes the plaintext URL token before calling migration 019's SECURITY DEFINER function. The preview RPC returns account name, invite role, and expiration, or a fixed `not_found`/`expired`/`used` reason. The route, rate limit, token utility, and Auth remain unchanged. Use PostgreSQL in disposable Docker Desktop only; no Supabase.

## In scope

- Accept only a 64-character hexadecimal token hash; plaintext token must never enter this repository or SQL.
- Call `public.peek_invitation` with a bound value and validate/sanitize its fixed JSON response shape.
- Preserve the three existing failure reasons and expose no token hash or invite columns.
- Unit tests and disposable PostgreSQL Docker integration using synthetic invitation rows.

## Out of scope

- Wiring/changing routes/pages, rate limiting, token generation/hash changes, Auth/session provider, or Supabase client use.
- Editing migration 019/RPC source, schema, permanent grants/RLS, or adding invitation lifecycle operations.
- Redemption, member/account changes, Storage, Realtime, real credentials/data, existing Docker resources, app traffic, production, stage, commit, push, deploy, reset, clean, or branch changes.

## Validation

- Focused Vitest for malformed hashes, bound input, success/failure shapes, response sanitization, and database/malformed-response failures.
- Disposable PostgreSQL 16 Docker with synthetic accounts/invitations, `--network none`, tmpfs, read-only mounts, no published ports/named volumes; temporary fixture RPC only.
- TypeScript, targeted ESLint (`--max-warnings=0`), Prettier check, `git diff --check`, SQL/PowerShell whitespace checks, and no residual task containers.

## Next action

Proceed to a separate PostgreSQL invitation-redemption repository slice. Keep this task `in_progress` and the route unwired.

## Implementation and validation

- Added `src/lib/repositories/invitation-preview.ts` and focused tests. `peekByTokenHash` accepts only a 64-character hexadecimal SHA-256 digest, lowercases it, binds it to `public.peek_invitation($1::text)`, and reconstructs only the fixed safe response fields. Malformed hashes return `not_found` without a database call; route, hash utility, rate limit, and migration 019 remain unchanged and unwired.
- TDD RED failed because the repository module was absent. Focused invitation tests passed 11/11; the broader account repository/guard suite passed 72/72 across 10 files. TypeScript, targeted ESLint with zero warnings, Prettier, and diff/whitespace checks passed.
- Disposable PostgreSQL 16 Docker integration passed with synthetic invitations, runtime `NOBYPASSRLS`, no direct SELECT grants on accounts or invitations, `--network none`, tmpfs, read-only mounts, no ports or volumes. It verified the safe success payload, `used`/`expired`/`not_found`, malformed hash behavior, and cleanup. Evidence: `.harness/tasks/20261019-225101-d76a/validation-postgres-invitation-preview-2133f41267.log`; no task containers remain.
- Task remains `in_progress`; the route is unwired. Supabase, Auth, redemption, Storage, Realtime, application traffic, and production remain out of scope.

## Independent read-only review

- Same-model Luna returned `APPROVE`, zero findings and zero caveats, limited to this invitation-preview repository slice.
- Reviewer confirmed `main`, expected HEAD, and task `in_progress`; checked digest-only input, bound lookup, fixed response sanitization, migration 019 fixture fidelity, and successful disposable PostgreSQL evidence. Review was read-only and ran no tests.
- This does not approve the overall HARNESS task, route wiring, Auth/session integration, invitation redemption, H-DB-003, Storage, Realtime, application traffic, or production.
