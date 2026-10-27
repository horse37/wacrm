# Task — PostgreSQL flow activation route

- id: `20261020-200711-5ef1`
- type: `migration`
- slug: `postgres-flow-activation-route`
- roadmap: H-DATA-003, phase 03
- status: `in_progress`

## Goal

Wire only `POST /api/flows/[id]/activate` to the approved PostgreSQL flow status-transition repository.

## Context

The route previously performed ownership reads, activation validation, and status updates through Supabase. The server-only PostgreSQL status-transition repository was independently reviewed and has disposable PostgreSQL 16 forced-RLS evidence in `.harness/tasks/20261020-053426-5b29/`. Keep the existing verified-session authentication call; Auth replacement is separate scope. The UI caller checks HTTP success and updates local status.

## In scope

- Keep current server-side authenticated-user lookup and request-body validation.
- Replace route data reads, activation validation, and update with `createPostgresFlowStatusTransitionRepository` using the verified user ID.
- Preserve 401, 400, 404, 422 validation issue behavior, and top-level `{ flow }` success shape.
- Add mocked-auth route tests for delegation, responses, authorization, and absence of Supabase data/admin calls on this POST.
- Update task evidence and handoff.

## Out of scope

GET/PUT/DELETE handlers; UI; Auth/session replacement; repository, schema, RLS, grant, or role changes; Supabase database/service access; real credentials/data; provider calls; app traffic; production; commit, push, deploy, reset, clean, or branch change. This slice does not approve H-DB-003/H-DATA-003 overall.

## Implementation

- The route keeps the existing `auth.getUser()` call and status body validation, then delegates the scoped state transition and activation validation to the PostgreSQL repository.
- Success keeps the `{ flow }` envelope and returns flow ID/status. Repository errors map to safe 401/403/404/500 responses. Error-severity activation issues preserve the 422 message and full issue list; warning-only results remain successful.
- TDD RED recorded six expected data-path failures; final focused route suite passed 9/9.

## Validation

See [`validation-focused-20261020.log`](validation-focused-20261020.log). TypeScript, targeted ESLint `--max-warnings=0`, Prettier check, and `git diff --check` passed. Existing repository forced-RLS validation and independent repository review were reused because no repository/SQL/RLS/grant code changed; evidence paths are in the validation log.

## Review

Independent GPT-6 Luna read-only review pending. Remediate findings and repeat until exact `APPROVE`, zero findings, and zero caveats. Approval is limited to this route slice.

## Next action

Run independent read-only review against this route slice, API response contract, focused evidence, and task limits.

## Independent review — 2026-10-20

GPT-6 Luna read-only review returned exact `APPROVE`, zero actionable findings, and zero caveats for `POST /api/flows/[id]/activate` only. Record: `review-gpt6-luna-final-20261020.md`. The approval is limited to this route slice; task remains `in_progress`, and H-DATA-003/H-DB-003 remain unapproved overall.