# Task — PostgreSQL invitation preview GET route

- id: `20261020-141550-1869`
- type: `migration`
- slug: `postgres-invitation-preview-get-route`
- roadmap: H-DATA-003, phase 03
- status: `in_progress`

## Goal

Serve public `GET /api/invitations/[token]/peek` through the existing PostgreSQL invitation-preview repository without changing its public contract.

## Context

The route currently calls Supabase RPC `peek_invitation`. `createPostgresInvitationPreviewRepository` already invokes the same SECURITY DEFINER RPC with a bound SHA-256 token digest and sanitizes its response. Its focused tests and disposable PostgreSQL 16 proof passed in task `20261019-225101-d76a`.

## In scope

- Replace only the route's Supabase persistence call with `createPostgresInvitationPreviewRepository`.
- Preserve per-IP rate limiting before database access, token hashing, public success/failure payloads, and safe `server_error` response.
- Add route tests for repository use, hash-only handoff, rate limiting, response compatibility, and database failures.
- Run focused Vitest, typecheck, targeted zero-warning ESLint, Prettier, and `git diff --check`; reuse existing disposable PostgreSQL proof unless repository code changes.

## Out of scope

Token/hash utility, preview repository/RPC/schema, redemption, join page, Auth/session policy, rate-limit policy, other routes, Supabase services, real credentials/data, app traffic, production, stage, commit, push, deploy, reset, restore, clean, rebase, or branch changes. H-DB-003/H-DATA-003 remain unapproved overall.

## Implementation and validation

- TDD RED: route tests failed 5/7 as expected before the route used PostgreSQL; the empty-token and rate-limit guards passed. Evidence: `tdd-red-invitation-preview-route.log`.
- GET now keeps the existing IP rate-limit check before token handling, hashes the URL token with the unchanged utility, and calls `createPostgresInvitationPreviewRepository`. It returns only the repository's fixed public result and maps failures to the existing 500 `server_error` payload. Supabase RPC use is removed from the route.
- Focused route and repository Vitest passed 18/18; TypeScript and targeted ESLint with `--max-warnings=0` passed. Prettier passed for new test/task/handoff files and for changed ranges in the legacy route/current-task record; `git diff --check` passed. Test evidence: `validation-final.log`.
- Disposable PostgreSQL 16 proof passed in Docker Desktop with synthetic data, `--network none`, tmpfs, read-only mounts, no published ports/named volumes, and no residual resources. It verified the hash-bound SECURITY DEFINER lookup and fixed result shape. Log: `.harness/tasks/20261019-225101-d76a/validation-postgres-invitation-preview-32cd338686.log`.
- Route unit tests mock the repository; PostgreSQL proof covers the unchanged repository. No Supabase persistence/network, real credentials/data, application traffic, or production was used.

## Independent review

Independent GPT-6 Luna read-only review returned exact `APPROVE`, zero findings, and zero caveats. Record: `review-gpt6-luna-20261020.md`. Approval covers this GET route slice only. H-DB-003/H-DATA-003, Auth replacement, Storage, Realtime, and production remain unapproved/out of scope.

## Next action

Proceed to the next narrow PostgreSQL repository-backed route slice. Keep this task's approval and H-DB-003/H-DATA-003 status separate.
