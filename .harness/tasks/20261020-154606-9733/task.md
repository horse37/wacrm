# Task — PostgreSQL account invitations GET route

- id: `20261020-154606-9733`
- type: `migration`
- slug: `postgres-account-invitations-get-route`
- roadmap: H-DATA-003, phase 03
- status: `in_progress`

## Goal

Wire only `GET /api/account/invitations` to the existing PostgreSQL invitations repository while preserving its authorization and response contract.

## Context

`src/lib/repositories/account-invitations.ts` already implements the read with account guard, forced-RLS identity, allowlisted columns, expiry/acceptance filtering, deterministic ordering, and no token-hash selection. Its two-account PostgreSQL 16 Docker proof is recorded in `.harness/tasks/20261019-221317-cbf2/validation-postgres-account-invitations-6b9c6b1532.log` and was independently approved for that repository slice.

## In scope

- Replace only the GET handler's Supabase read with `createPostgresAccountInvitationsRepository`.
- Preserve `requireRole('admin')`, the `{ invitations: [...] }` contract, allowlisted fields, and safe error responses.
- Add focused route tests for identity wiring, authorization, safe PostgreSQL errors, and no direct Supabase data calls.

## Out of scope

- POST invitation creation, invitation revoke route, repository/schema/policy changes, Auth/session redesign, other account routes, Storage, Realtime, real data/credentials, Supabase service access, application traffic, production, commit, push, deploy, reset, clean, or branch changes.
- H-DB-003/H-DATA-003 completion or broad approval.

## Validation

- TDD RED then focused Vitest for `src/app/api/account/invitations/route.test.ts`.
- TypeScript, targeted ESLint with `--max-warnings=0`, Prettier on the new test and changed route ranges, and `git diff --check`.
- Reuse the existing disposable PostgreSQL 16 Docker proof above; no real or non-disposable PostgreSQL resources.
- Independent GPT-6 Luna read-only review until exact `APPROVE`, zero findings, and zero caveats.

## Next action

Obtain an independent GPT-6 Luna read-only review of the scoped diff and validation evidence.

## Implementation and validation

- Replaced only the GET handler's Supabase read with `createPostgresAccountInvitationsRepository`, passing only the verified `ctx.userId`; POST and its existing Supabase behavior remain untouched.
- Preserved `requireRole('admin')`, `{ invitations: [...] }`, and generic 500 text. PostgreSQL permission errors map to 403. Route tests cover identity wiring/order, no `.from()`/`.rpc()` calls, authorization, and safe DB errors.
- TDD RED: 3 failed / 1 passed. Focused Vitest: 4/4. TypeScript and targeted ESLint (`--max-warnings=0`) passed.
- Prettier passed the new test and both changed route ranges. Whole-file route check still fails; checking the unchanged HEAD route also fails, so the existing route formatting outside this GET change was left intact. Logs: `validation-prettier-route-full.log` and `validation-prettier-route-baseline.log`.
- `git diff --check` passed (Git emitted existing LF/CRLF normalization warnings in the dirty tree). Existing disposable PostgreSQL 16 Docker proof was reused: `.harness/tasks/20261019-221317-cbf2/validation-postgres-account-invitations-6b9c6b1532.log`; no new container or database resource was created.
- No Supabase service, real credentials/data, application traffic, or production was used. H-DB-003/H-DATA-003 remain `in_progress` and unapproved overall.

## Independent review

Independent GPT-6 Luna read-only review returned exact `APPROVE`, zero findings, and zero caveats. Reviewer confirmed branch `main` and the expected HEAD; checked admin authorization, callback limited to verified `ctx.userId`, response without `token_hash`, no `.from()`/`.rpc()` in GET, unchanged POST behavior, safe error mapping, and disposable PostgreSQL evidence. The whole-file Prettier failure was also present at HEAD. See `review-gpt6-luna-20261020.md`. This approval is limited to this GET route; H-DB-003/H-DATA-003 remain in progress and unapproved overall.

## Next action

Continue with the next narrow invitation write-route migration slice; keep Auth/session, repository/schema/grants, and broader migration approval separate.
