# Task — PostgreSQL ownership-transfer POST route

- id: `20261020-145507-8c48`
- type: `migration`
- slug: `postgres-account-ownership-transfer-post-route`
- roadmap: H-DATA-003, phase 03
- status: `in_progress` (route slice approved; H-DATA-003 remains ongoing)

## Goal

Route `POST /api/account/transfer-ownership` through the existing PostgreSQL ownership-transfer repository.

## Context

The route still calls `transfer_account_ownership` through `ctx.supabase.rpc`. The existing server-only PostgreSQL repository and its disposable PostgreSQL 16 Docker proof are in `.harness/tasks/20261019-224605-f3c4/`; the RPC remains responsible for the atomic owner and role updates.

## In scope

- Replace only the route's direct RPC call with `createPostgresAccountOwnershipTransferRepository`, using the identity already verified by `requireRole('owner')`.
- Preserve owner authorization, per-user rate-limit ordering, UUID validation, success JSON, and existing HTTP status categories; map SQLSTATE `42501` to 403 and `22023` to 400 with safe error text.
- Add focused route tests for authorization, rate-limit ordering, malformed input, verified identity handoff, repository invocation, response compatibility, SQLSTATE mapping, and safe error handling.
- Run focused tests, TypeScript, targeted zero-warning ESLint, Prettier, and `git diff --check`; reuse the disposable PostgreSQL 16 repository proof because repository/RPC/schema remain unchanged.

## Out of scope

Auth/session implementation, UI, repository implementation, RPC/migration/schema/grants, other routes, Supabase persistence/network, real credentials/data, shared Docker resources, application traffic, production, commit, push, deploy, reset, restore, clean, rebase, or branch changes. H-DB-003/H-DATA-003 remain unapproved overall.

## Validation

- `npx vitest run src/app/api/account/transfer-ownership/route.test.ts` — focused route contract tests.
- `npx tsc --noEmit` and targeted ESLint with `--max-warnings=0` — type and lint checks.
- `npx prettier --check <changed files>` and `git diff --check` — formatting and whitespace.
- Reuse `.harness/tasks/20261019-224605-f3c4/validation-postgres-account-ownership-transfer-3576300ce0.log` — existing disposable PostgreSQL 16 repository/RPC proof; no Supabase persistence or application traffic.

## Implementation and validation

- TDD RED: 9 route cases failed before implementation and 2 passed. Evidence: `tdd-red-ownership-transfer-post-route.log`.
- The route now hands only the Auth-verified `ctx.userId` to the existing PostgreSQL repository, preserves owner guard/rate-limit/input order and `{ ok: true }`, and no longer calls `ctx.supabase.rpc`.
- Focused Vitest passed 12/12 (`validation-focused-tests.log`); TypeScript, targeted ESLint `--max-warnings=0`, Prettier, and `git diff --check` passed (logs in this folder).
- Existing disposable Docker PostgreSQL 16 repository proof remains applicable because repository/RPC/schema are unchanged; evidence: `.harness/tasks/20261019-224605-f3c4/validation-postgres-account-ownership-transfer-3576300ce0.log`. It used synthetic data, `--network none`, tmpfs, read-only mounts, and confirmed cleanup.

## Independent review

Independent GPT-6 Luna read-only review returned `APPROVE`, zero findings and zero caveats; evidence: `review-gpt6-luna-final-20261020.md`. Approval covers this task and route only. H-DB-003/H-DATA-003 overall, Auth generally, Storage, Realtime, application traffic, and production remain unapproved.

## Next action

Continue to the next narrow PostgreSQL-backed route task; keep H-DATA-003/H-DB-003 in progress and unapproved overall.
