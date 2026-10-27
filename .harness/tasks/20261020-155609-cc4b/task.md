# Task — PostgreSQL account invitation POST route

- id: `20261020-155609-cc4b`
- type: `migration`
- slug: `postgres-account-invitation-post-route`
- roadmap: H-DATA-003, phase 03
- status: `in_progress`

## Goal

Wire only `POST /api/account/invitations` to PostgreSQL while preserving authorization, validation, rate limiting, and one-time token response behavior.

## Context

The GET route is independently approved in `.harness/tasks/20261020-154606-9733/`. The shared invitations repository already has a `create` method, but existing Docker evidence only covers read behavior. Validate its insert path against synthetic PostgreSQL 16 in Docker Desktop before using it.

## In scope

- Replace only POST's direct Supabase insert with `createPostgresAccountInvitationsRepository(...).create(...)`.
- Preserve admin authorization, per-user rate-limit key/order, role and label validation, expiry behavior, response shape, and plaintext token returned only once.
- Add focused route tests proving verified user wiring, token-hash-only persistence input, no Supabase data calls, and safe errors.
- Add task-local repository create integration coverage under forced RLS in disposable Docker PostgreSQL; no production grant or policy changes.

## Out of scope

- GET behavior, revoke route, repository/schema/policy changes outside disposable test fixtures, Auth/session redesign, other account routes, Storage, Realtime, real credentials/data, Supabase service access, application traffic, production, commit, push, deploy, reset, clean, or branch changes.
- H-DB-003/H-DATA-003 completion or broad approval.

## Validation

- TDD RED then focused route and repository tests.
- Docker Desktop PostgreSQL 16 integration with synthetic fixtures, forced RLS, least-privilege runtime role, and automatic cleanup.
- TypeScript, targeted ESLint with `--max-warnings=0`, Prettier on changed ranges/tests, and `git diff --check`.
- Independent GPT-6 Luna read-only review until exact `APPROVE`, zero findings, and zero caveats.

## Implementation and validation — 2026-10-20

- POST now calls the existing PostgreSQL invitations repository with the verified session user ID. Admin authorization, per-user rate-limit key/order, role and label validation, expiry clamping, 201 response shape, and one-time plaintext token response remain in place. Only the SHA-256 token hash is passed to repository persistence; GET behavior was left functionally unchanged.
- TDD RED is recorded in `validation-tdd-red.md`: before implementation, the focused route suite had 2 expected failures and 7 passes because POST still used Supabase and lacked PostgreSQL permission-error mapping.
- Final focused Vitest passed 15/15: route tests plus repository create tests. TypeScript passed; targeted ESLint passed with `--max-warnings=0`; targeted Prettier check passed.
- Disposable Docker Desktop PostgreSQL 16 forced-RLS proof passed with synthetic users/accounts, a `NOBYPASSRLS` runtime role, hash-only storage, account isolation, viewer/missing-session denial, transaction-local identity cleanup, read-only source mount, `--network none`, tmpfs, automatic cleanup, and no residual containers. Final evidence: `validation-postgres-account-invitation-create-0971f41ffa.log`.
- Independent GPT-6 Luna read-only review returned `APPROVE`, zero findings, and zero caveats for this POST route slice; report: `review-gpt6-luna-final-20261020.md`. Approval is limited to the route and task-local evidence. The HARNESS task remains `in_progress`; H-DB-003/H-DATA-003 remain unapproved overall.

## Next action

Proceed to the next narrowly scoped H-DATA-003 PostgreSQL slice using disposable Docker Desktop PostgreSQL. Keep this task `in_progress`; this route review does not approve H-DB-003/H-DATA-003 overall.
