# Task — PostgreSQL account-members GET route

- id: `20261020-152617-9d3a`
- type: `migration`
- slug: `postgres-account-members-get-route`
- roadmap: H-DATA-003, phase 03
- status: `in_progress`

## Goal

Serve `GET /api/account/members` from the existing PostgreSQL account-members repository while preserving the response contract and current authorization boundary.

## Context

The repository and its two-account PostgreSQL 16 Docker proof are already reviewed and recorded in `.harness/tasks/20261019-215941-005d/`. The current GET route still queries Supabase for member rows. The verified-session/Auth context is a separate migration boundary and remains unchanged in this task.

## In scope

- Replace the route's direct Supabase member-row query with `createPostgresAccountMembersRepository`.
- Preserve `{ members }`, verified caller identity, role-sensitive email visibility, unknown-role filtering, deterministic ordering, and safe error responses.
- Add focused route tests, including that the PostgreSQL repository receives only the session-verified user ID and direct Supabase data queries are absent.
- Reuse existing disposable PostgreSQL evidence because repository implementation is unchanged.

## Out of scope

- Repository implementation/tests, migrations, schema, grants/RLS, Auth/session-provider redesign or removal, other routes/pages, account mutations, Storage, Realtime, real Supabase/local Supabase, real credentials/data, application traffic, VPS, production, commit, push, deploy, reset, clean, or branch changes.
- H-DB-003/H-DATA-003 completion or broad approval.

## Validation

- TDD RED and focused route Vitest, one worker at a time.
- TypeScript, targeted ESLint with `--max-warnings=0`, targeted Prettier check, and `git diff --check`.
- Reconfirm applicability of the existing PostgreSQL 16 disposable Docker proof; do not contact any Supabase service or use non-disposable data/resources.
- Independent GPT-6 Luna read-only review until exact `APPROVE`, zero findings, and zero caveats.

## Next action

Obtain independent GPT-6 Luna read-only review; remediate/re-review until exact `APPROVE`, zero findings, and zero caveats.

## Implementation and validation

- Replaced the direct Supabase member-row query with `createPostgresAccountMembersRepository`; the existing account/Auth context remains unchanged and only its verified `userId` is passed to the repository.
- The `{ members }` payload and existing 401 behavior are preserved. PostgreSQL `42501` and account-denial errors map to 403; unexpected DB errors return the existing generic 500 body without exposing database text.
- The route has no direct Supabase `.from()` or `.rpc()` calls. Route tests mock the existing Auth context and repository; no Supabase service is contacted.
- TDD RED: 4 failed / 1 passed against the old route; evidence `validation-red.log`. Final focused Vitest: 5/5; evidence `validation-focused-tests.log`.
- TypeScript, targeted ESLint with `--max-warnings=0`, targeted Prettier check, and `git diff --check` passed.
- Existing disposable PostgreSQL 16 Docker proof for the unchanged account-members repository remains applicable: `.harness/tasks/20261019-215941-005d/validation-postgres-account-members-5501c04534.log`. This route-only task created no Docker resource and used only synthetic database fixtures from that proof.
- No Supabase service, real credentials/data, application traffic, or production was used. H-DB-003/H-DATA-003 remain `in_progress` and unapproved overall.

## Independent review

Independent GPT-6 Luna read-only review returned **APPROVE**, zero findings, and zero caveats, limited to this GET route slice; see `review-gpt6-luna-final-20261020.md`. The review made no edits or test runs. The HARNESS task remains `in_progress`; H-DB-003/H-DATA-003 remain unapproved overall.

## Next action

Choose the next narrow H-DATA-003 route/repository slice. Do not infer task-wide approval from this route review.
