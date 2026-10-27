# Task — PostgreSQL account invitation revoke DELETE route

- id: `20261020-193400-d4b7`
- type: `migration`
- slug: `postgres-account-invitation-revoke-delete-route`
- roadmap: H-DATA-003, phase 03
- status: `in_progress`

## Goal

Wire only `DELETE /api/account/invitations/[id]` through the PostgreSQL invitations repository while preserving its authorization, rate limit, hard-delete, 404, and success behavior.

## Context

The route still calls Supabase. The PostgreSQL repository `revoke` method was implemented and independently approved in task `20261019-222508-5090`; its disposable PostgreSQL 16 forced-RLS evidence is `../20261019-222508-5090/validation-postgres-account-invitation-revoke-50f70d10e3.log`. The invitation GET and POST routes now use PostgreSQL and have separate, slice-limited approvals.

## In scope

- Replace only the route's Supabase delete with `createPostgresAccountInvitationsRepository(...).revoke(id)`.
- Preserve `requireRole('admin')`, per-user rate-limit key/order, parameter handling, `{ ok: true }` on success, and 404 for missing or cross-account invitations.
- Add focused route tests for repository wiring, admin/rate-limit behavior, no Supabase data calls, not-found behavior, and safe database errors.
- Record focused validation and obtain an independent GPT-6 Luna read-only review of this route slice.

## Out of scope

- Changes to the repository, schema, RLS policies, grants, GET/POST behavior, Auth/session provider, or other account routes.
- Supabase service access, real credentials/data, application traffic, production, commit, push, deploy, reset, clean, or branch changes.
- Approval or completion of H-DB-003/H-DATA-003 as a whole.

## Validation

- TDD RED then targeted invitation route tests; retain GET/POST regressions.
- Reuse the approved disposable PostgreSQL 16 repository proof; rerun it only if repository code changes.
- TypeScript, targeted ESLint with `--max-warnings=0`, Prettier check, and `git diff --check`.
- Independent read-only review until exact `APPROVE`, zero findings, and zero caveats.

## Implementation and validation — 2026-10-20

- The DELETE route now calls the PostgreSQL invitations repository with the authenticated user ID, preserves admin authorization/rate-limit order, returns 404 for missing or cross-account rows, and returns `{ ok: true }` on success. PostgreSQL permission errors map to 403; other repository errors use a generic 500 response. No Supabase data call remains in this route.
- TDD RED is recorded in `validation-tdd-red.log`: before implementation, the focused route suite had 4 expected failures and 1 pass because the route still used Supabase.
- Final Vitest passed 14/14 across the new DELETE route tests and existing invitation GET/POST route tests. TypeScript passed; targeted ESLint passed with `--max-warnings=0`; Prettier check passed; `git diff --check` exited 0.
- The repository was not changed. Its previously approved disposable Docker Desktop PostgreSQL 16 forced-RLS proof is reused from `.harness/tasks/20261019-222508-5090/validation-postgres-account-invitation-revoke-50f70d10e3.log`; no Supabase service, real credentials/data, traffic, production, commit, push, or deploy was used.

## Next action

Independent GPT-6 Luna read-only review returned exact `APPROVE`, zero findings, and zero caveats; report: `review-gpt6-luna-final-20261020.md`. Approval is limited to this DELETE route slice and its evidence. Keep the task `in_progress`; H-DB-003/H-DATA-003 remain unapproved overall. Proceed to the next narrow PostgreSQL slice.
