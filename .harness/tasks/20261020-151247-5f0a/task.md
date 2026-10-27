# Task — PostgreSQL account-member PATCH/DELETE routes

- id: `20261020-151247-5f0a`
- type: `migration`
- slug: `postgres-account-members-patch-delete-routes`
- roadmap: H-DATA-003, phase 03
- status: `in_progress`

## Goal

Route `PATCH` and `DELETE /api/account/members/[userId]` through the existing PostgreSQL repositories while preserving the public request, success payloads, validation, authorization, and rate-limit behavior.

## Context

Both handlers still call `ctx.supabase.rpc`. The server-only role and removal repositories are implemented and validated in `.harness/tasks/20261019-222944-b638/` and `.harness/tasks/20261019-224019-e819/`; those approved slices explicitly leave route wiring for a separate task. They accept a verified-session callback derived from `ctx.userId` and call the existing migration 018 RPC inside PostgreSQL transactions. No repository or database changes are needed here.

## In scope

- Replace only the `PATCH` and `DELETE` Supabase RPC calls in `src/app/api/account/members/[userId]/route.ts` with the existing PostgreSQL repositories.
- Preserve admin authorization, rate-limit keys and ordering, async route params, role validation, owner-promotion rejection, and success JSON. Map repository errors to safe HTTP statuses/messages; missing or cross-account targets retain the repository's privacy-preserving `not_found` category.
- Add focused route tests for both methods, repository wiring, authorization/rate-limit short-circuiting, response shape, and the absence of direct Supabase RPC calls.

## Out of scope

- Repository implementations/tests, migration 018, RPC definitions, schema, grants, account-member GET route, other account routes, Auth/session redesign, Supabase Auth removal, Storage, Realtime, UI, production or real data/credentials.
- Commit, push, deploy, branch change, or broad approval of H-DB-003/H-DATA-003.

## Validation

- `npm test -- --maxWorkers=1 --no-file-parallelism 'src/app/api/account/members/[userId]/route.test.ts'` — focused Vitest, one worker at a time.
- `npx tsc --noEmit`.
- Targeted ESLint with `--max-warnings=0` for the route and its test.
- Targeted Prettier check and `git diff --check`.
- Confirm only intended methods changed and no direct `.rpc` calls remain in this route. Existing disposable PostgreSQL 16 repository proofs remain the evidence for the unchanged dependencies; do not use Supabase or real data.

## Implementation and validation

- `PATCH` uses `createPostgresAccountMemberRoleRepository`; `DELETE` uses `createPostgresAccountMemberRemovalRepository`. Both repositories receive only the Auth-verified user ID. Auth guard, rate-limit keys/order, role checks, and success payloads remain in the route.
- Repository errors map to safe responses: SQLSTATE `42501`/forbidden → 403, `22023`/bad request → 400, unavailable target → 404, conflict → 409, and unknown database failures → generic 500. Response bodies do not expose raw database messages.
- TDD RED: 4 failed / 5 passed against the old direct-RPC route (`validation-red.log`). Final focused tests: 11/11 (`validation-focused-tests.log`). TypeScript, targeted zero-warning ESLint, targeted Prettier check, and global `git diff --check` passed.
- No Docker resource was created for route tests; the unchanged role/removal repositories retain their disposable PostgreSQL 16 proofs in the two dependency task folders. No Supabase, real credentials/data, or application traffic was used.

## Independent review

- Independent GPT-6 Luna read-only review returned **APPROVE**, zero findings, and zero caveats for this route slice only; see `review-gpt6-luna-final-20261020.md`.
- The review made no edits and ran no tests. The HARNESS task remains `in_progress`; H-DB-003/H-DATA-003 remain unapproved overall.

## Next action

Proceed to the separate GET `/api/account/members` route-wiring task using the existing PostgreSQL repository. Keep H-DB-003/H-DATA-003 in progress and unapproved overall.
