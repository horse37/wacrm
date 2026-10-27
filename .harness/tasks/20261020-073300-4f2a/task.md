# Task — PostgreSQL automation list screen

- id: `20261020-073300-4f2a`
- type: `migration`
- slug: `postgres-automation-list-screen`
- status: `in_progress`

## Goal

Replace the automation list screen's browser Supabase read with the existing PostgreSQL-backed `GET /api/automations` endpoint.

## Context

The list route and its repository passed independent GPT-6 Luna review for their slices. Existing route validates the server session, returns `{ automations }`, and exposes only automation-card fields. Keep that auth boundary. PostgreSQL integration uses disposable Docker Desktop only; no Supabase persistence or validation network.

## In scope

- Use same-origin `GET /api/automations` for list loading and refresh after duplicate/delete.
- Preserve card fields, loading/error states, and existing PATCH/duplicate/DELETE actions.
- Add focused client-fetch tests for success, safe API errors, and malformed responses.
- Run focused Vitest, TypeScript, targeted zero-warning ESLint, Prettier, existing disposable PostgreSQL 16 Docker validator with `--network none`, and `git diff --check`.
- Obtain independent GPT-6 Luna read-only review; remediate and repeat until exact `APPROVE`, zero findings, zero caveats.

## Out of scope

Other routes/screens, Auth/session migration, Supabase persistence or validation calls, schema/grant/RLS changes, real credentials/data, app traffic, production, commit, push, deploy, reset, clean, rebase, or branch change. Preserve all local work. Keep this task and H-DATA-003/H-DB-003 unapproved overall.

## Next action

Implement the list-screen API client and switch only the list-loading path. Start with client helper tests.

## Implementation and validation

Added `fetchAutomationList` as a small same-origin client for `GET /api/automations`; it sends same-origin credentials, preserves the route's safe error message, rejects malformed envelopes, and returns the card DTO. The automation list page now uses it for initial loading and post-duplicate/delete refresh. Existing PATCH/duplicate/DELETE actions, session boundary, cards, and UI states are unchanged. The page no longer imports a browser Supabase client or reads `automations` directly.

TDD RED confirmed the helper module was absent. Initial focused Vitest passed 37/37; after remediation, focused Vitest passed 38/38 across client helper, GET route, repository, and account guard. `npx tsc --noEmit` passed; targeted ESLint passed with `--max-warnings=0`; Prettier passed for the screen, helper, tests, task, and handoff. Static boundary check confirmed no Supabase client/table read remains in the page. Disposable Docker Desktop PostgreSQL 16 forced-RLS regression passed; evidence: `.harness/tasks/20261020-012732-0a44/validation-postgres-automation-list-9a68cf3604.log` (`--network none`, generated credentials, synthetic fixtures, read-only repository mounts, tmpfs, no residual resources). `git diff --check` passed.

Prettier check of `.harness/current-task.md` was not included in final source/doc check: the pinned-HEAD copy also fails Prettier, so older task-history formatting was preserved. No Supabase persistence or validation network, real data/credentials, schema/grant/RLS changes, traffic, production, commit, push, or deploy. Task and H-DATA-003/H-DB-003 remain unapproved overall.
