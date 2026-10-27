# Implementer handoff — PostgreSQL invitation redemption POST route

## Scope

Wire authenticated `POST /api/invitations/[token]/redeem` to the existing PostgreSQL repository. Keep the existing public endpoint and Auth session check. A narrow shared error-wrapper/repository change preserves SQLSTATE `42501` and maps it to the route's existing 401 behavior. RPC, migration 019, schema, grants, join page, and rate-limit policy are unchanged.

## Changes

- Replaced direct `supabase.rpc('redeem_invitation', ...)` with `createPostgresInvitationRedemptionRepository`.
- Passed the already server-verified `user.id` to the repository guard; retained IP rate limiting before token and session processing, SHA-256 token hashing, and `{ ok: true, accountId }` success response.
- Added route tests covering rate-limit ordering, missing token, missing session, hash-only repository input, verified identity handoff, success response, all repository error categories, and sanitized database failures.
- Replaced raw PostgREST messages with safe repository error text. Repository SQLSTATE `42501` maps to `unauthorized`; a missing caller profile maps to HTTP 401 to preserve the route's previous behavior. Other database failures keep the generic HTTP 500 body.

## Validation

- TDD RED: 8 expected route failures, 3 guard cases passed before implementation; see `../tdd-red-invitation-redemption-route.log`.
- Post-remediation focused route/repository Vitest: 20/20 (`../validation-remediation-tests.log`). TypeScript, targeted ESLint with zero warnings, Prettier, and `git diff --check` passed; remediation logs are in this task folder.
- Re-ran the disposable PostgreSQL 16 proof after the SQLSTATE fix: `../validation-postgres-invitation-redemption-df9a203779.log`. Docker used `--network none`, tmpfs database storage, a read-only repository mount, and synthetic data/credentials; proof passed with 42501 mapping and no residual task containers. No Supabase persistence or application traffic was used.

## Limits and next action

Final independent GPT-6 Luna read-only review returned `APPROVE`, zero findings and zero caveats; record: `../review-gpt6-luna-final-20261020.md`. Approval covers only this route slice and its records. Task stays `in_progress` while H-DATA-003 continues; H-DB-003/H-DATA-003 overall, Auth generally, Storage, Realtime, app traffic, and production remain unapproved. Continue to the next narrow PostgreSQL-backed route task.
