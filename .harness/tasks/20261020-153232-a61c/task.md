# Task — PostgreSQL account rename PATCH route

- id: `20261020-153232-a61c`
- type: `migration`
- slug: `postgres-account-rename-patch-route`
- roadmap: H-DATA-003, phase 03
- status: `in_progress`

## Goal

Wire `PATCH /api/account` to the existing PostgreSQL account-rename repository while preserving current input validation, authorization, rate limiting, and response contract.

## Context

The server-only repository and its disposable PostgreSQL 16 Docker proof were independently reviewed and approved as a repository slice in `.harness/tasks/20261019-220632-41dc/`. The route still writes through Supabase. Existing account/Auth context remains a separate boundary.

## In scope

- Replace only the PATCH handler's Supabase account update with `createPostgresAccountRepository`.
- Preserve `requireRole("admin")`, user-keyed rate limiting and order, 80-character name rules, `{ account: { id, name } }`, and safe error responses.
- Add focused PATCH route tests, including verified user-ID wiring and no direct Supabase data calls.
- Reuse existing Docker PostgreSQL 16 repository evidence because the repository is unchanged.

## Out of scope

- GET handler, repository implementation/tests, migrations/schema/grants/RLS, Auth/session redesign or removal, account members/invitations, Storage, Realtime, Supabase service access, real credentials/data, application traffic, production, commit, push, deploy, reset, clean, or branch changes.
- H-DB-003/H-DATA-003 completion or broad approval.

## Validation

- TDD RED and focused route Vitest, one worker at a time.
- TypeScript, targeted ESLint with `--max-warnings=0`, targeted Prettier check, and `git diff --check`.
- Confirm reusability of `.harness/tasks/20261019-220632-41dc/validation-postgres-account-rename-f3e7753de3.log`; no Supabase service access or non-disposable data/resources.
- Independent GPT-6 Luna read-only review until exact `APPROVE`, zero findings, and zero caveats.

## Implementation and validation

- Replaced only PATCH's Supabase account update with `createPostgresAccountRepository`; existing GET handler and Auth context semantics are unchanged. Repository receives only verified `ctx.userId` and rechecks admin role in PostgreSQL.
- Preserved rate-limit key/order, trimmed account name, 80-character validation, and `{ account: { id, name } }`. PostgreSQL role/permission errors map to 403, missing account to 404, and unexpected DB errors to the existing generic 500 response.
- Focused tests cover success, verified identity, admin/rate-limit ordering, validation, safe PostgreSQL errors, and no direct Supabase `.from()`/`.rpc()` calls. TDD RED: 3 failed / 5 passed; final focused Vitest: 10/10. Evidence: `validation-red.log` and `validation-focused-tests.log`.
- TypeScript, targeted ESLint with `--max-warnings=0`, targeted Prettier check, and `git diff --check` passed.
- Existing disposable PostgreSQL 16 Docker proof for the unchanged repository remains applicable: `.harness/tasks/20261019-220632-41dc/validation-postgres-account-rename-f3e7753de3.log`. No Docker resource was created by route tests; the proof uses synthetic fixtures only.
- No Supabase service, real credentials/data, application traffic, or production was used. H-DB-003/H-DATA-003 remain `in_progress` and unapproved overall.

## Independent review

First independent GPT-6 Luna review returned `REMEDIATION_REQUIRED` for a claimed generic 500 text change. Direct comparison against HEAD and the route test showed the current text is identical to the existing contract (`Failed to update account`); see `review-cycle-1-gpt6-luna-20261020.md`. No code change was needed. Read-only re-review returned `APPROVE`, zero findings and zero caveats, limited to this PATCH route; see `review-cycle-2-gpt6-luna-20261020.md`. Task/H-DATA-003 remain `in_progress`; this is not broad migration approval.

## Next action

Continue with the next narrow H-DATA-003 route migration slice. Preserve the approval boundary above and keep the wider migration in progress.
