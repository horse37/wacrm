# Task — PostgreSQL invitation redemption POST route

- id: `20261020-142945-9e1d`
- type: `migration`
- slug: `postgres-invitation-redemption-post-route`
- roadmap: H-DATA-003, phase 03
- status: `in_progress` (route slice approved; H-DATA-003 remains ongoing)

## Goal

Route authenticated `POST /api/invitations/[token]/redeem` through the existing PostgreSQL invitation-redemption repository.

## Context

The repository slice in `20261019-225656-ca32` wraps migration 019's `public.redeem_invitation` RPC and passed disposable PostgreSQL 16 validation. The route still performed the Supabase RPC directly. Wire the route to PostgreSQL and include only the narrow SQLSTATE compatibility mapping needed to preserve its existing 401 behavior. Keep the verified-session check.

## In scope

- Replace the route's Supabase RPC write with `createPostgresInvitationRedemptionRepository`.
- Preserve per-IP rate-limit ordering, token hashing, verified session enforcement, success JSON, and HTTP error status behavior; return only safe error text.
- Preserve SQLSTATE `42501` in the shared database error wrapper and map it to the existing HTTP 401 behavior in this repository; map a missing caller profile to 401 as well.
- Add focused route tests for rate limiting, session enforcement, hash-only repository input, verified identity handoff, response compatibility, and safe error mapping.
- Run focused tests, typecheck, targeted zero-warning ESLint, Prettier, and `git diff --check`; rerun the disposable PostgreSQL 16 proof after the SQLSTATE mapping. RPC, migration, schema, and grants remain unchanged.

## Out of scope

Auth/session implementation, join UI, rate-limit policy, unrelated repository behavior, RPC/migration/schema/grants, other routes, Supabase persistence/network, real credentials/data, shared Docker resources, application traffic, production, stage, commit, push, deploy, reset, restore, clean, rebase, or branch changes. H-DB-003/H-DATA-003 remain unapproved overall.

## Implementation and validation

- TDD RED: 8 route cases failed before implementation while the 3 guard cases passed. Evidence: `tdd-red-invitation-redemption-route.log`.
- Removed the direct Supabase `redeem_invitation` RPC. The POST route retains the per-IP rate-limit order, empty-token response, `auth.getUser()` session check, SHA-256 hashing, success payload, and status categories. It passes only the verified `user.id` to the repository guard and maps repository failures to safe responses; database failures keep the existing generic 500 body.
- Initial focused route/repository validation passed 19/19. Independent review found that SQLSTATE `42501` could be surfaced as HTTP 500 instead of preserving the route's prior 401 behavior.
- Remediation preserves SQLSTATE internally, maps repository `42501` to `unauthorized`, and maps a missing caller profile (`forbidden`) to HTTP 401. Other database failures keep the generic safe HTTP 500 response.
- Post-remediation focused route/repository tests passed 20/20 (`validation-remediation-tests.log`); TypeScript, targeted ESLint `--max-warnings=0`, Prettier, and `git diff --check` passed. Remediation logs are in this task folder.
- Re-ran the disposable PostgreSQL 16 proof after remediation: `validation-postgres-invitation-redemption-df9a203779.log`. It passed hash-only RPC, success/replay/invalid/conflict/42501 mapping, 11 domain-data guards, least-privilege runtime, transaction-local identity cleanup, and bootstrap state assertions. Docker used `--network none`, tmpfs database storage, a read-only repository mount, and synthetic data/credentials; no task containers remain. No Supabase persistence or application traffic was used.

## Independent review

Final independent GPT-6 Luna read-only review returned `APPROVE`, with zero findings and zero caveats; record: `review-gpt6-luna-final-20261020.md`. Approval covers only this route slice and its records. H-DB-003/H-DATA-003, Auth generally, Storage, Realtime, application traffic, and production remain outside approval.

## Next action

Continue to the next narrow PostgreSQL-backed route task; keep H-DATA-003/H-DB-003 in progress and unapproved overall.
